// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

use crate::config::ResponseMode;
use crate::{SERVER_SCHEMA, STATE_VARIANT_COUNT};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AddonCapability<'a> {
    fallback: &'a str,
    kind: &'a str,
    path: Option<&'a str>,
    required: bool,
    supported: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DynamicBytes {
    by_variant: Vec<usize>,
    maximum: usize,
    minimum: usize,
}

#[derive(Serialize)]
struct ResponseBytes {
    cached: usize,
    dynamic: DynamicBytes,
}

#[derive(Serialize)]
struct Routes<'a> {
    activity: &'a str,
    cached: &'a str,
    dynamic: &'a str,
    ready: &'a str,
    settings: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadyMetadata<'a> {
    addon_capability: AddonCapability<'a>,
    app_id: &'a str,
    cache_mode: &'a str,
    input_policy: &'a str,
    response_bytes: ResponseBytes,
    response_mode: &'a str,
    routes: Routes<'a>,
    runtime_id: &'a str,
    runtime_version: &'a str,
    schema: &'a str,
    server_id: &'a str,
    state_variant_count: usize,
    status: &'a str,
    streaming: &'a str,
    worker_count: usize,
}

#[derive(Serialize)]
pub(crate) struct Announcement<'a> {
    #[serde(flatten)]
    pub(crate) metadata: &'a ReadyMetadata<'a>,
    pub(crate) host: &'a str,
    pub(crate) port: u16,
    pub(crate) url: String,
}

pub(crate) fn build_metadata(
    lengths: Vec<usize>,
    cached: usize,
    app_id: &'static str,
    response_mode: ResponseMode,
) -> ReadyMetadata<'static> {
    let minimum = lengths.iter().copied().min().unwrap_or_default();
    let maximum = lengths.iter().copied().max().unwrap_or_default();
    ReadyMetadata {
        addon_capability: AddonCapability {
            fallback: "not-applicable",
            kind: "native-rust",
            path: None,
            required: false,
            supported: true,
        },
        app_id,
        cache_mode: "dynamic-and-cached",
        input_policy: "request-timestamped-input",
        response_bytes: ResponseBytes {
            cached,
            dynamic: DynamicBytes {
                by_variant: lengths,
                maximum,
                minimum,
            },
        },
        response_mode: response_mode.as_str(),
        routes: Routes {
            activity: "/activity",
            cached: "/cached",
            dynamic: "/dynamic",
            ready: "/__bench/ready",
            settings: "/settings",
        },
        runtime_id: "rust",
        runtime_version: "native",
        schema: SERVER_SCHEMA,
        server_id: "actix",
        state_variant_count: STATE_VARIANT_COUNT,
        status: "ready",
        streaming: match response_mode {
            // The complete suite always renders through WebUIHandler::render
            // and publishes one fully collected response for every WebUI
            // family case (Light DOM, Shadow DOM, and FAST V3 alike).
            ResponseMode::Complete => "buffered",
            ResponseMode::Progressive => {
                if app_id == "webui" {
                    "progressive-boundaries"
                } else {
                    "native-chunks"
                }
            }
        },
        worker_count: 1,
    }
}

#[cfg(test)]
mod tests {
    use super::build_metadata;
    use crate::config::ResponseMode;
    use crate::STATE_VARIANT_COUNT;

    #[test]
    fn metadata_reports_runtime_cache_and_response_sizes() {
        let lengths = (100..100 + STATE_VARIANT_COUNT).collect::<Vec<_>>();
        let metadata = build_metadata(lengths, 99, "webui", ResponseMode::Progressive);
        assert_eq!(metadata.runtime_id, "rust");
        assert_eq!(metadata.server_id, "actix");
        assert_eq!(metadata.app_id, "webui");
        assert_eq!(metadata.cache_mode, "dynamic-and-cached");
        assert_eq!(metadata.state_variant_count, STATE_VARIANT_COUNT);
        assert_eq!(metadata.streaming, "progressive-boundaries");
        assert_eq!(metadata.response_mode, "progressive");
        assert_eq!(metadata.response_bytes.cached, 99);
        assert_eq!(metadata.response_bytes.dynamic.minimum, 100);
        assert_eq!(
            metadata.response_bytes.dynamic.maximum,
            100 + STATE_VARIANT_COUNT - 1
        );
        assert!(metadata.addon_capability.supported);
    }

    #[test]
    fn metadata_identifies_the_fast_v3_app() {
        let metadata = build_metadata(
            vec![100; STATE_VARIANT_COUNT],
            99,
            "webui-fast",
            ResponseMode::Progressive,
        );
        assert_eq!(metadata.app_id, "webui-fast");
        assert_eq!(metadata.streaming, "native-chunks");
    }

    #[test]
    fn metadata_reports_the_complete_suite_as_buffered_for_every_app() {
        let webui = build_metadata(
            vec![100; STATE_VARIANT_COUNT],
            99,
            "webui",
            ResponseMode::Complete,
        );
        assert_eq!(webui.streaming, "buffered");
        assert_eq!(webui.response_mode, "complete");
        let fast = build_metadata(
            vec![100; STATE_VARIANT_COUNT],
            99,
            "webui-fast",
            ResponseMode::Complete,
        );
        assert_eq!(fast.streaming, "buffered");
        assert_eq!(fast.response_mode, "complete");
    }
}
