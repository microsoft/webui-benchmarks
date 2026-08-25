// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

#![allow(unsafe_code)]

use anyhow::{Context, Result};
use serde::Serialize;
use std::alloc::{GlobalAlloc, Layout, System};
use std::hint::black_box;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use todo_profile::{
    CountWriter, ProfileFixture, StringWriter, STATE_VARIANT_COUNT, TODO_ITEM_COUNT,
};
use webui_handler::{Protocol, RenderOptions, ResponseWriter, WebUIHandler};

struct CountingAllocator;

static ACTIVE: AtomicBool = AtomicBool::new(false);
static ALLOC_CALLS: AtomicUsize = AtomicUsize::new(0);
static ALLOC_ZEROED_CALLS: AtomicUsize = AtomicUsize::new(0);
static REALLOC_CALLS: AtomicUsize = AtomicUsize::new(0);
static DEALLOC_CALLS: AtomicUsize = AtomicUsize::new(0);
static ALLOCATED_BYTES: AtomicUsize = AtomicUsize::new(0);
static REALLOCATED_BYTES: AtomicUsize = AtomicUsize::new(0);
static DEALLOCATED_BYTES: AtomicUsize = AtomicUsize::new(0);

fn record(counter: &AtomicUsize, bytes: &AtomicUsize, size: usize) {
    if ACTIVE.load(Ordering::Relaxed) {
        counter.fetch_add(1, Ordering::Relaxed);
        bytes.fetch_add(size, Ordering::Relaxed);
    }
}

// SAFETY: every operation forwards the original pointer and layout unchanged to
// the system allocator. The atomics observe calls but do not alter allocation
// or deallocation semantics.
unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        record(&ALLOC_CALLS, &ALLOCATED_BYTES, layout.size());
        // SAFETY: `layout` is forwarded unchanged from the allocator caller.
        unsafe { System.alloc(layout) }
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        record(&ALLOC_ZEROED_CALLS, &ALLOCATED_BYTES, layout.size());
        // SAFETY: `layout` is forwarded unchanged from the allocator caller.
        unsafe { System.alloc_zeroed(layout) }
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        record(&DEALLOC_CALLS, &DEALLOCATED_BYTES, layout.size());
        // SAFETY: the pointer and layout came from the matching system call.
        unsafe { System.dealloc(pointer, layout) }
    }

    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        record(&REALLOC_CALLS, &REALLOCATED_BYTES, new_size);
        // SAFETY: all arguments are forwarded unchanged from the caller.
        unsafe { System.realloc(pointer, layout, new_size) }
    }
}

#[global_allocator]
static GLOBAL: CountingAllocator = CountingAllocator;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct AllocationSnapshot {
    alloc_calls: usize,
    alloc_zeroed_calls: usize,
    realloc_calls: usize,
    dealloc_calls: usize,
    allocated_bytes: usize,
    reallocated_bytes: usize,
    deallocated_bytes: usize,
}

impl AllocationSnapshot {
    fn reset() {
        for counter in [
            &ALLOC_CALLS,
            &ALLOC_ZEROED_CALLS,
            &REALLOC_CALLS,
            &DEALLOC_CALLS,
            &ALLOCATED_BYTES,
            &REALLOCATED_BYTES,
            &DEALLOCATED_BYTES,
        ] {
            counter.store(0, Ordering::Relaxed);
        }
    }

    fn capture() -> Self {
        Self {
            alloc_calls: ALLOC_CALLS.load(Ordering::Relaxed),
            alloc_zeroed_calls: ALLOC_ZEROED_CALLS.load(Ordering::Relaxed),
            realloc_calls: REALLOC_CALLS.load(Ordering::Relaxed),
            dealloc_calls: DEALLOC_CALLS.load(Ordering::Relaxed),
            allocated_bytes: ALLOCATED_BYTES.load(Ordering::Relaxed),
            reallocated_bytes: REALLOCATED_BYTES.load(Ordering::Relaxed),
            deallocated_bytes: DEALLOCATED_BYTES.load(Ordering::Relaxed),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VariantAllocations {
    variant_index: usize,
    light_component: RenderAllocations,
    light_flat: RenderAllocations,
    shadow_component: RenderAllocations,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RenderAllocations {
    output_bytes: usize,
    count_only_excluding_output_buffer: AllocationSnapshot,
    reused_output_excluding_output_buffer: AllocationSnapshot,
    fresh_output_including_output_buffer: AllocationSnapshot,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AllocationReport {
    schema: &'static str,
    state_variants: usize,
    todo_items_per_variant: usize,
    light_output_capacity: usize,
    shadow_output_capacity: usize,
    variants: Vec<VariantAllocations>,
}

struct AllocationWriters {
    count_only: CountWriter,
    reused: StringWriter,
}

impl AllocationWriters {
    fn with_capacity(capacity: usize) -> Self {
        Self {
            count_only: CountWriter::default(),
            reused: StringWriter::with_capacity(capacity),
        }
    }
}

fn measured<T>(operation: impl FnOnce() -> T) -> (T, AllocationSnapshot) {
    AllocationSnapshot::reset();
    ACTIVE.store(true, Ordering::SeqCst);
    let result = operation();
    ACTIVE.store(false, Ordering::SeqCst);
    (result, AllocationSnapshot::capture())
}

fn render(
    handler: &WebUIHandler,
    protocol: &Protocol,
    state: &serde_json::Value,
    writer: &mut dyn ResponseWriter,
) {
    handler
        .render(
            protocol,
            state,
            &RenderOptions::new("index.html", "/"),
            writer,
        )
        .unwrap_or_else(|error| panic!("allocation render failed: {error}"));
}

fn measure_render(
    handler: &WebUIHandler,
    protocol: &Protocol,
    state: &serde_json::Value,
    capacity: usize,
    writers: &mut AllocationWriters,
) -> Result<RenderAllocations> {
    writers.count_only.clear();
    let (_, count_only_snapshot) = measured(|| {
        render(
            black_box(handler),
            black_box(protocol),
            black_box(state),
            black_box(&mut writers.count_only),
        );
        black_box(writers.count_only.snapshot());
    });

    writers.reused.clear();
    let (output_bytes, reused_snapshot) = measured(|| {
        render(
            black_box(handler),
            black_box(protocol),
            black_box(state),
            black_box(&mut writers.reused),
        );
        black_box(writers.reused.output.len())
    });

    let (fresh_output_bytes, fresh_snapshot) = measured(|| {
        let mut writer = StringWriter::with_capacity(capacity);
        render(
            black_box(handler),
            black_box(protocol),
            black_box(state),
            black_box(&mut writer),
        );
        let length = black_box(writer.output.len());
        drop(writer);
        length
    });
    if fresh_output_bytes != output_bytes {
        anyhow::bail!("fresh and reused output sizes differ");
    }

    Ok(RenderAllocations {
        output_bytes,
        count_only_excluding_output_buffer: count_only_snapshot,
        reused_output_excluding_output_buffer: reused_snapshot,
        fresh_output_including_output_buffer: fresh_snapshot,
    })
}

fn warm_protocol(
    handler: &WebUIHandler,
    protocol: &Protocol,
    states: &[serde_json::Value],
    writer: &mut StringWriter,
) {
    for state in states {
        writer.clear();
        render(handler, protocol, state, writer);
    }
}

fn main() -> Result<()> {
    let fixture = ProfileFixture::load()?;
    let light_capacity = fixture.light_capacity();
    let shadow_capacity = fixture.shadow_capacity();
    let handler = WebUIHandler::new();
    let mut light_writers = AllocationWriters::with_capacity(light_capacity);
    let mut flat_writers = AllocationWriters::with_capacity(light_capacity);
    let mut shadow_writers = AllocationWriters::with_capacity(shadow_capacity);

    for _ in 0..3 {
        warm_protocol(
            &handler,
            &fixture.light,
            &fixture.states,
            &mut light_writers.reused,
        );
        warm_protocol(
            &handler,
            &fixture.flat,
            &fixture.states,
            &mut flat_writers.reused,
        );
        warm_protocol(
            &handler,
            &fixture.shadow,
            &fixture.states,
            &mut shadow_writers.reused,
        );
    }

    let mut variants = Vec::with_capacity(fixture.states.len());
    for (variant_index, state) in fixture.states.iter().enumerate() {
        let light_component = measure_render(
            &handler,
            &fixture.light,
            state,
            light_capacity,
            &mut light_writers,
        )?;
        let light_flat = measure_render(
            &handler,
            &fixture.flat,
            state,
            light_capacity,
            &mut flat_writers,
        )?;
        if light_flat.output_bytes != light_component.output_bytes {
            anyhow::bail!("flat output differs for variant {variant_index}");
        }
        let shadow_component = measure_render(
            &handler,
            &fixture.shadow,
            state,
            shadow_capacity,
            &mut shadow_writers,
        )?;
        variants.push(VariantAllocations {
            variant_index,
            light_component,
            light_flat,
            shadow_component,
        });
    }

    let report = AllocationReport {
        schema: "webui.ssr-todo-profile-allocations/v2",
        state_variants: STATE_VARIANT_COUNT,
        todo_items_per_variant: TODO_ITEM_COUNT,
        light_output_capacity: light_capacity,
        shadow_output_capacity: shadow_capacity,
        variants,
    };
    serde_json::to_writer_pretty(std::io::stdout(), &report)
        .context("failed to serialize allocation report")?;
    println!();
    Ok(())
}
