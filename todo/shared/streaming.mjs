// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

const encoder = new TextEncoder();

function byteChunk(value) {
  if (typeof value === "string") return encoder.encode(value);
  if (value instanceof Uint8Array) return value;
  throw new TypeError("Streaming chunks must be strings or Uint8Array values");
}

export function concatenateByteStreams(parts) {
  let activeRead;
  let cancelled = false;
  let index = 0;
  let reader;
  return new ReadableStream({
    async cancel(reason) {
      cancelled = true;
      const failures = [];
      if (reader !== undefined) {
        const activeReader = reader;
        const pendingRead = activeRead;
        try {
          await activeReader.cancel(reason);
        } catch (error) {
          failures.push(error);
        }
        try {
          await pendingRead;
        } catch (error) {
          failures.push(error);
        } finally {
          if (reader === activeReader) {
            activeReader.releaseLock();
            reader = undefined;
            index += 1;
          }
        }
      }
      for (; index < parts.length; index += 1) {
        const part = parts[index];
        if (!(part instanceof ReadableStream)) continue;
        try {
          await part.cancel(reason);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, "Failed to cancel concatenated streams");
      }
    },
    async pull(controller) {
      if (cancelled) return;
      while (index < parts.length) {
        const part = parts[index];
        if (part instanceof ReadableStream) {
          reader ??= part.getReader();
          const activeReader = reader;
          const read = activeReader.read();
          activeRead = read;
          let result;
          try {
            result = await read;
          } finally {
            if (activeRead === read) activeRead = undefined;
          }
          if (cancelled) return;
          if (result.done) {
            if (reader === activeReader) {
              activeReader.releaseLock();
              reader = undefined;
              index += 1;
            }
            continue;
          }
          controller.enqueue(byteChunk(result.value));
          return;
        }
        index += 1;
        const chunk = byteChunk(part);
        if (chunk.byteLength > 0) {
          controller.enqueue(chunk);
          return;
        }
      }
      controller.close();
    },
  });
}

export async function collectByteStream(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = byteChunk(result.value);
      chunks.push(chunk);
      total += chunk.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
