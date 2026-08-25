// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

use actix_web::http::header::{HeaderValue, CACHE_CONTROL, CONTENT_TYPE};
use actix_web::{web, HttpResponse};
use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::hint::black_box;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use todo_profile::{
    batch_chunks, record_chunks, render_to_string, replay_chunks, resolve_compiled_path,
    synthetic_fixture, CountWriter, ProfileFixture, StringWriter, SyntheticKind,
    STATE_VARIANT_COUNT, TODO_ITEM_COUNT,
};
use webui_expressions::evaluate;
use webui_handler::plugin::webui::WebUIHydrationPlugin;
use webui_handler::{encode_safe, Protocol, RenderOptions, ResponseWriter, WebUIHandler};
use webui_protocol::ConditionExpr;
use webui_state::find_value_by_dotted_path_ref;

const HTML_CONTENT_TYPE: &str = "text/html; charset=utf-8";
const CACHE_CONTROL_VALUE: &str = "no-store";
const INNER_OPERATIONS: usize = 256;

fn render(
    handler: &WebUIHandler,
    protocol: &Protocol,
    state: &Value,
    writer: &mut dyn ResponseWriter,
) {
    handler
        .render(
            protocol,
            state,
            &RenderOptions::new("index.html", "/"),
            writer,
        )
        .unwrap_or_else(|error| panic!("benchmark render failed: {error}"));
}

fn response(body: web::Bytes, variant: HeaderValue) -> HttpResponse {
    HttpResponse::Ok()
        .insert_header((CONTENT_TYPE, HTML_CONTENT_TYPE))
        .insert_header((CACHE_CONTROL, CACHE_CONTROL_VALUE))
        .insert_header(("x-webui-bench-cache", "dynamic"))
        .insert_header(("x-webui-bench-variant", variant))
        .body(body)
}

fn actual_render_benches(c: &mut Criterion) {
    let fixture = ProfileFixture::load()
        .unwrap_or_else(|error| panic!("failed to load todo fixture: {error:#}"));
    let handler = WebUIHandler::new();
    let light_capacity = fixture.light_capacity();
    let shadow_capacity = fixture.shadow_capacity();
    let average_bytes = fixture.light_output_sizes.iter().sum::<usize>() / STATE_VARIANT_COUNT;
    let mut group = c.benchmark_group("actual_render");
    group.throughput(Throughput::Bytes(average_bytes as u64));

    group.bench_function("light_component_reused_output", |b| {
        let mut writer = StringWriter::with_capacity(light_capacity);
        let mut cursor = 0;
        b.iter(|| {
            writer.clear();
            let state = &fixture.states[cursor];
            cursor = (cursor + 1) % fixture.states.len();
            render(
                &handler,
                black_box(&fixture.light),
                black_box(state),
                &mut writer,
            );
            black_box(&writer.output);
        });
    });

    group.bench_function("light_flat_reused_output", |b| {
        let mut writer = StringWriter::with_capacity(light_capacity);
        let mut cursor = 0;
        b.iter(|| {
            writer.clear();
            let state = &fixture.states[cursor];
            cursor = (cursor + 1) % fixture.states.len();
            render(
                &handler,
                black_box(&fixture.flat),
                black_box(state),
                &mut writer,
            );
            black_box(&writer.output);
        });
    });

    group.bench_function("shadow_component_reused_output", |b| {
        let mut writer = StringWriter::with_capacity(shadow_capacity);
        let mut cursor = 0;
        b.iter(|| {
            writer.clear();
            let state = &fixture.states[cursor];
            cursor = (cursor + 1) % fixture.states.len();
            render(
                &handler,
                black_box(&fixture.shadow),
                black_box(state),
                &mut writer,
            );
            black_box(&writer.output);
        });
    });

    group.bench_function("light_component_count_only_output", |b| {
        let mut writer = CountWriter::default();
        let mut cursor = 0;
        b.iter(|| {
            writer.clear();
            let state = &fixture.states[cursor];
            cursor = (cursor + 1) % fixture.states.len();
            render(
                &handler,
                black_box(&fixture.light),
                black_box(state),
                &mut writer,
            );
            black_box(writer.snapshot());
        });
    });

    group.bench_function("light_component_fresh_output", |b| {
        let mut cursor = 0;
        b.iter(|| {
            let state = &fixture.states[cursor];
            cursor = (cursor + 1) % fixture.states.len();
            let mut writer = StringWriter::with_capacity(light_capacity);
            render(
                &handler,
                black_box(&fixture.light),
                black_box(state),
                &mut writer,
            );
            black_box(writer.output);
        });
    });

    let variant_headers = (0..STATE_VARIANT_COUNT)
        .map(|index| {
            HeaderValue::from_str(&index.to_string())
                .unwrap_or_else(|error| panic!("invalid variant header: {error}"))
        })
        .collect::<Vec<_>>();
    group.bench_function("light_component_http_response", |b| {
        let mut cursor = 0;
        b.iter(|| {
            let index = cursor;
            let state = &fixture.states[index];
            cursor = (cursor + 1) % fixture.states.len();
            let mut writer = StringWriter::with_capacity(light_capacity);
            render(
                &handler,
                black_box(&fixture.light),
                black_box(state),
                &mut writer,
            );
            black_box(response(
                web::Bytes::from(writer.output),
                variant_headers[index].clone(),
            ));
        });
    });

    let cached_output =
        render_to_string(&handler, &fixture.light, &fixture.states[0], light_capacity)
            .unwrap_or_else(|error| panic!("failed to render cached response: {error:#}"));
    let cached_bytes = web::Bytes::copy_from_slice(cached_output.as_bytes());
    group.bench_function("http_response_cached_bytes", |b| {
        b.iter(|| {
            black_box(response(
                black_box(cached_bytes.clone()),
                HeaderValue::from_static("0"),
            ));
        });
    });
    group.bench_function("http_response_fresh_equal_bytes", |b| {
        b.iter(|| {
            let mut body = String::with_capacity(cached_output.len());
            body.push_str(black_box(&cached_output));
            black_box(response(
                web::Bytes::from(body),
                HeaderValue::from_static("0"),
            ));
        });
    });

    let next_atomic = AtomicUsize::new(0);
    group.throughput(Throughput::Elements(1));
    group.bench_function("state_rotation_atomic", |b| {
        b.iter(|| {
            let index = next_atomic.fetch_add(1, Ordering::Relaxed) % fixture.states.len();
            black_box(&fixture.states[index]);
        });
    });
    group.bench_function("state_rotation_plain", |b| {
        let mut cursor = 0;
        b.iter(|| {
            let state = &fixture.states[cursor];
            cursor = (cursor + 1) % fixture.states.len();
            black_box(state);
        });
    });
    group.finish();
}

fn official_render_benches(c: &mut Criterion) {
    let fixture = ProfileFixture::load()
        .unwrap_or_else(|error| panic!("failed to load todo fixture: {error:#}"));
    let core_handler = WebUIHandler::new();
    let handler = WebUIHandler::with_plugin(|| Box::new(WebUIHydrationPlugin::new()));
    let initial_capacity = fixture.light_capacity().saturating_mul(2);
    let output_sizes = fixture
        .states
        .iter()
        .map(|state| {
            render_to_string(&handler, &fixture.light, state, initial_capacity)
                .unwrap_or_else(|error| panic!("failed to size hydrated output: {error:#}"))
                .len()
        })
        .collect::<Vec<_>>();
    let capacity = output_sizes.iter().copied().max().unwrap_or(initial_capacity);
    let average_bytes = output_sizes.iter().sum::<usize>() / output_sizes.len();
    let variant_headers = (0..STATE_VARIANT_COUNT)
        .map(|index| {
            HeaderValue::from_str(&index.to_string())
                .unwrap_or_else(|error| panic!("invalid variant header: {error}"))
        })
        .collect::<Vec<_>>();
    let mut group = c.benchmark_group("official_render");
    group.throughput(Throughput::Bytes(average_bytes as u64));

    group.bench_function("core_reused_control", |b| {
        let mut writer = StringWriter::with_capacity(fixture.light_capacity());
        let mut cursor = 0;
        b.iter(|| {
            writer.clear();
            let state = &fixture.states[cursor];
            cursor = (cursor + 1) % fixture.states.len();
            render(
                &core_handler,
                black_box(&fixture.light),
                black_box(state),
                &mut writer,
            );
            black_box(&writer.output);
        });
    });

    group.bench_function("hydrated_reused_output", |b| {
        let mut writer = StringWriter::with_capacity(capacity);
        let mut cursor = 0;
        b.iter(|| {
            writer.clear();
            let state = &fixture.states[cursor];
            cursor = (cursor + 1) % fixture.states.len();
            render(
                &handler,
                black_box(&fixture.light),
                black_box(state),
                &mut writer,
            );
            black_box(&writer.output);
        });
    });

    group.bench_function("hydrated_fresh_output", |b| {
        let mut cursor = 0;
        b.iter(|| {
            let state = &fixture.states[cursor];
            cursor = (cursor + 1) % fixture.states.len();
            let mut writer = StringWriter::with_capacity(capacity);
            render(
                &handler,
                black_box(&fixture.light),
                black_box(state),
                &mut writer,
            );
            black_box(writer.output);
        });
    });

    group.bench_function("hydrated_http_response", |b| {
        let mut cursor = 0;
        b.iter(|| {
            let index = cursor;
            let state = &fixture.states[index];
            cursor = (cursor + 1) % fixture.states.len();
            let mut writer = StringWriter::with_capacity(capacity);
            render(
                &handler,
                black_box(&fixture.light),
                black_box(state),
                &mut writer,
            );
            black_box(response(
                web::Bytes::from(writer.output),
                variant_headers[index].clone(),
            ));
        });
    });

    let cached_output =
        render_to_string(&handler, &fixture.light, &fixture.states[0], capacity)
            .unwrap_or_else(|error| panic!("failed to render hydrated response: {error:#}"));
    let cached_bytes = web::Bytes::copy_from_slice(cached_output.as_bytes());
    group.bench_function("hydrated_cached_bytes_response", |b| {
        b.iter(|| {
            black_box(response(
                black_box(cached_bytes.clone()),
                HeaderValue::from_static("0"),
            ));
        });
    });
    group.bench_function("hydrated_fresh_equal_bytes_response", |b| {
        b.iter(|| {
            let mut body = String::with_capacity(cached_output.len());
            body.push_str(black_box(&cached_output));
            black_box(response(
                web::Bytes::from(body),
                HeaderValue::from_static("0"),
            ));
        });
    });
    group.finish();
}

fn writer_benches(c: &mut Criterion) {
    let fixture = ProfileFixture::load()
        .unwrap_or_else(|error| panic!("failed to load todo fixture: {error:#}"));
    let chunks = record_chunks(&fixture.light, &fixture.states[0])
        .unwrap_or_else(|error| panic!("failed to record chunks: {error:#}"));
    let batches = batch_chunks(&chunks, 4096);
    let one_chunk = vec![chunks.concat()];
    let capacity = fixture.light_capacity();
    let mut group = c.benchmark_group("writer_replay");
    group.throughput(Throughput::Bytes(one_chunk[0].len() as u64));

    for (name, source) in [
        ("original_calls", chunks.as_slice()),
        ("four_kib_batches", batches.as_slice()),
        ("single_call_ceiling", one_chunk.as_slice()),
    ] {
        group.bench_function(name, |b| {
            let mut writer = StringWriter::with_capacity(capacity);
            b.iter(|| {
                writer.clear();
                replay_chunks(black_box(source), &mut writer)
                    .unwrap_or_else(|error| panic!("chunk replay failed: {error}"));
                black_box(&writer.output);
            });
        });
    }
    group.finish();
}

fn synthetic_render_benches(c: &mut Criterion) {
    let scenarios = [
        ("flat_global", SyntheticKind::FlatGlobal),
        ("component_global", SyntheticKind::ComponentGlobal),
        ("flat_one_attribute", SyntheticKind::FlatOneAttribute),
        (
            "component_one_attribute",
            SyntheticKind::ComponentOneAttribute,
        ),
        ("flat_four_attributes", SyntheticKind::FlatFourAttributes),
        (
            "component_four_attributes",
            SyntheticKind::ComponentFourAttributes,
        ),
        ("flat_condition", SyntheticKind::FlatCondition),
        ("identifier_condition", SyntheticKind::IdentifierCondition),
    ];
    let handler = WebUIHandler::new();
    let mut group = c.benchmark_group("focused_protocol");
    group.throughput(Throughput::Elements(TODO_ITEM_COUNT as u64));

    for (name, kind) in scenarios {
        let (protocol, state) = synthetic_fixture(kind);
        let output = render_to_string(&handler, &protocol, &state, 4096)
            .unwrap_or_else(|error| panic!("synthetic warmup failed: {error:#}"));
        group.bench_with_input(
            BenchmarkId::from_parameter(name),
            &(protocol, state, output.len()),
            |b, (protocol, state, capacity)| {
                let mut writer = StringWriter::with_capacity(*capacity);
                b.iter(|| {
                    writer.clear();
                    render(&handler, black_box(protocol), black_box(state), &mut writer);
                    black_box(&writer.output);
                });
            },
        );
    }
    group.finish();
}

fn primitive_benches(c: &mut Criterion) {
    let fixture = ProfileFixture::load()
        .unwrap_or_else(|error| panic!("failed to load todo fixture: {error:#}"));
    let todo = fixture.states[0]
        .get("todos")
        .and_then(Value::as_array)
        .and_then(|todos| todos.first())
        .unwrap_or_else(|| panic!("todo fixture must have a first item"));
    let mut state_map = Map::new();
    state_map.insert("todo".to_owned(), todo.clone());
    let state = Value::Object(state_map);

    let mut paths = c.benchmark_group("state_path");
    paths.throughput(Throughput::Elements(INNER_OPERATIONS as u64));
    for (name, path) in [
        ("one_segment", "todo"),
        ("two_segments", "todo.title"),
        ("three_segments", "todo.assignee.name"),
    ] {
        paths.bench_function(name, |b| {
            b.iter(|| {
                for _ in 0..INNER_OPERATIONS {
                    black_box(find_value_by_dotted_path_ref(
                        black_box(path),
                        black_box(&state),
                    ));
                }
            });
        });
    }
    paths.bench_function("two_segments_precompiled", |b| {
        let parts = ["todo", "title"];
        b.iter(|| {
            for _ in 0..INNER_OPERATIONS {
                black_box(resolve_compiled_path(black_box(&parts), black_box(&state)));
            }
        });
    });
    paths.bench_function("three_segments_precompiled", |b| {
        let parts = ["todo", "assignee", "name"];
        b.iter(|| {
            for _ in 0..INNER_OPERATIONS {
                black_box(resolve_compiled_path(black_box(&parts), black_box(&state)));
            }
        });
    });
    paths.finish();

    let mut conditions = c.benchmark_group("condition_eval");
    let simple = ConditionExpr::identifier("todo.completed");
    conditions.throughput(Throughput::Elements(INNER_OPERATIONS as u64));
    conditions.bench_function("identifier", |b| {
        b.iter(|| {
            for _ in 0..INNER_OPERATIONS {
                black_box(
                    evaluate(black_box(&simple), black_box(&state))
                        .unwrap_or_else(|error| panic!("condition failed: {error}")),
                );
            }
        });
    });
    conditions.finish();

    let mut escaping = c.benchmark_group("html_escape");
    let safe = "Todo item 0001 benchmark workload";
    let escaped = "0/3 <todo> & \"owner\"";
    escaping.throughput(Throughput::Elements(INNER_OPERATIONS as u64));
    escaping.bench_function("borrowed_safe", |b| {
        b.iter(|| {
            for _ in 0..INNER_OPERATIONS {
                black_box(encode_safe(black_box(safe)));
            }
        });
    });
    escaping.bench_function("owned_escaped", |b| {
        b.iter(|| {
            for _ in 0..INNER_OPERATIONS {
                black_box(encode_safe(black_box(escaped)));
            }
        });
    });
    escaping.finish();

    let keys = (0..64)
        .map(|index| format!("fragment-{index}"))
        .collect::<Vec<_>>();
    let fragment_map = keys
        .iter()
        .enumerate()
        .map(|(index, key)| (key.clone(), index))
        .collect::<HashMap<_, _>>();
    let fragment_vec = (0..64).collect::<Vec<_>>();
    let mut dispatch = c.benchmark_group("fragment_reference");
    dispatch.throughput(Throughput::Elements(INNER_OPERATIONS as u64));
    dispatch.bench_function("string_hash_lookup", |b| {
        b.iter(|| {
            for index in 0..INNER_OPERATIONS {
                let key = &keys[index % keys.len()];
                black_box(fragment_map.get(black_box(key.as_str())));
            }
        });
    });
    dispatch.bench_function("numeric_index", |b| {
        b.iter(|| {
            for index in 0..INNER_OPERATIONS {
                black_box(fragment_vec.get(black_box(index % fragment_vec.len())));
            }
        });
    });
    dispatch.finish();
}

enum ScopeValue<'a> {
    Borrowed(&'a Value),
}

fn scope_storage_benches(c: &mut Criterion) {
    let values = [
        Value::String("a".to_owned()),
        Value::String("b".to_owned()),
        Value::String("c".to_owned()),
        Value::String("d".to_owned()),
    ];
    let names = ["a", "b", "c", "d"];
    let mut group = c.benchmark_group("scope_storage");
    group.throughput(Throughput::Elements(TODO_ITEM_COUNT as u64));

    group.bench_function("split_owned_borrowed_maps", |b| {
        let mut owned: HashMap<&str, Value> = HashMap::with_capacity(4);
        let mut borrowed: HashMap<&str, &Value> = HashMap::with_capacity(4);
        b.iter(|| {
            for _ in 0..TODO_ITEM_COUNT {
                owned.clear();
                borrowed.clear();
                for (index, name) in names.iter().enumerate() {
                    borrowed.insert(name, &values[index]);
                }
                for name in names {
                    black_box(
                        borrowed
                            .get(black_box(name))
                            .copied()
                            .or_else(|| owned.get(name)),
                    );
                }
            }
        });
    });

    group.bench_function("unified_map", |b| {
        let mut unified: HashMap<&str, ScopeValue<'_>> = HashMap::with_capacity(4);
        b.iter(|| {
            for _ in 0..TODO_ITEM_COUNT {
                unified.clear();
                for (index, name) in names.iter().enumerate() {
                    unified.insert(name, ScopeValue::Borrowed(&values[index]));
                }
                for name in names {
                    let value = unified.get(black_box(name)).map(|entry| match entry {
                        ScopeValue::Borrowed(value) => *value,
                    });
                    black_box(value);
                }
            }
        });
    });

    group.bench_function("precomputed_slots", |b| {
        b.iter(|| {
            for _ in 0..TODO_ITEM_COUNT {
                let slots = [
                    Some(&values[0]),
                    Some(&values[1]),
                    Some(&values[2]),
                    Some(&values[3]),
                ];
                for slot in &slots {
                    black_box(slot);
                }
            }
        });
    });
    group.finish();
}

criterion_group! {
    name = benches;
    config = Criterion::default()
        .warm_up_time(Duration::from_secs(2))
        .measurement_time(Duration::from_secs(5))
        .sample_size(60);
    targets =
        actual_render_benches,
        official_render_benches,
        writer_benches,
        synthetic_render_benches,
        primitive_benches,
        scope_storage_benches
}
criterion_main!(benches);
