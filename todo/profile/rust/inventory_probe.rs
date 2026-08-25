// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

use anyhow::{Context, Result};
use serde::Serialize;
use todo_profile::{
    batch_chunks, escaped_entity_count, operation_counts, protocol_inventory, record_chunks,
    render_to_string, CountWriter, OperationCounts, ProfileFixture, ProtocolInventory, WriterStats,
    LIGHT_PROTOCOL_PATH, SHADOW_PROTOCOL_PATH,
};
use webui_handler::{RenderOptions, WebUIHandler};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StateInventory {
    variant_index: usize,
    light_bytes: usize,
    shadow_bytes: usize,
    escaped_entities: usize,
    writer: WriterStats,
    operations: OperationCounts,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChunkInventory {
    batched_calls: usize,
    original_calls: usize,
    output_bytes: usize,
    single_call_ceiling: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InventoryReport {
    schema: &'static str,
    light_protocol: ProtocolInventory,
    shadow_protocol: ProtocolInventory,
    chunks: ChunkInventory,
    states: Vec<StateInventory>,
}

fn main() -> Result<()> {
    let fixture = ProfileFixture::load()?;
    let handler = WebUIHandler::new();
    let mut states = Vec::with_capacity(fixture.states.len());

    for (variant_index, state) in fixture.states.iter().enumerate() {
        let mut writer = CountWriter::default();
        handler
            .render(
                &fixture.light,
                state,
                &RenderOptions::new("index.html", "/"),
                &mut writer,
            )
            .with_context(|| format!("failed to count writes for variant {variant_index}"))?;
        let output = render_to_string(&handler, &fixture.light, state, fixture.light_capacity())?;
        states.push(StateInventory {
            variant_index,
            light_bytes: output.len(),
            shadow_bytes: fixture.shadow_output_sizes[variant_index],
            escaped_entities: escaped_entity_count(&output),
            writer: writer.snapshot(),
            operations: operation_counts(&fixture.light, state)?,
        });
    }

    let chunks = record_chunks(&fixture.light, &fixture.states[0])?;
    let batched = batch_chunks(&chunks, 4096);
    let report = InventoryReport {
        schema: "webui.ssr-todo-profile-inventory/v1",
        light_protocol: protocol_inventory(LIGHT_PROTOCOL_PATH)?,
        shadow_protocol: protocol_inventory(SHADOW_PROTOCOL_PATH)?,
        chunks: ChunkInventory {
            batched_calls: batched.len(),
            original_calls: chunks.len(),
            output_bytes: chunks.iter().map(String::len).sum(),
            single_call_ceiling: 1,
        },
        states,
    };
    serde_json::to_writer_pretty(std::io::stdout(), &report)
        .context("failed to serialize inventory")?;
    println!();
    Ok(())
}
