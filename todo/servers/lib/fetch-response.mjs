// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export function toFetchResponse(result) {
  return new Response(result.headOnly ? null : result.body, {
    headers: result.headers,
    status: result.status,
  });
}
