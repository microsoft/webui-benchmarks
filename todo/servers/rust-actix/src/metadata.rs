// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

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
    cached: &'a str,
    dynamic: &'a str,
    ready: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadyMetadata<'a> {
    addon_capability: AddonCapability<'a>,
    app_id: &'a str,
    cache_mode: &'a str,
    input_policy: &'a str,
    response_bytes: ResponseBytes,
    routes: Routes<'a>,
    runtime_id: &'a str,
    runtime_version: &'a str,
    schema: &'a str,
    server_id: &'a str,
    state_variant_count: usize,
    status: &'a str,
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
        routes: Routes {
            cached: "/cached",
            dynamic: "/dynamic",
            ready: "/__bench/ready",
        },
        runtime_id: "rust",
        runtime_version: "native",
        schema: SERVER_SCHEMA,
        server_id: "actix",
        state_variant_count: STATE_VARIANT_COUNT,
        status: "ready",
        worker_count: 1,
    }
}

#[cfg(test)]
mod tests {
    use super::build_metadata;
    use crate::STATE_VARIANT_COUNT;

    #[test]
    fn metadata_reports_runtime_cache_and_response_sizes() {
        let lengths = (100..100 + STATE_VARIANT_COUNT).collect::<Vec<_>>();
        let metadata = build_metadata(lengths, 99, "webui");
        assert_eq!(metadata.runtime_id, "rust");
        assert_eq!(metadata.server_id, "actix");
        assert_eq!(metadata.app_id, "webui");
        assert_eq!(metadata.cache_mode, "dynamic-and-cached");
        assert_eq!(metadata.state_variant_count, STATE_VARIANT_COUNT);
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
        let metadata = build_metadata(vec![100; STATE_VARIANT_COUNT], 99, "webui-fast");
        assert_eq!(metadata.app_id, "webui-fast");
    }
}
