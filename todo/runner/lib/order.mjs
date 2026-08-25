// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

function hashSeed(seed) {
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function nextRandom(state) {
  let value = state.value += 0x6D2B79F5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
}

export function deterministicOrder(
  values,
  round,
  seed = "webui-ssr-todo-benchmark",
) {
  if (!Number.isInteger(round) || round < 0) {
    throw new RangeError("round must be a non-negative integer");
  }
  const ordered = [...values];
  const state = { value: hashSeed(`${seed}:${round}`) };
  for (let index = ordered.length - 1; index > 0; index -= 1) {
    const target = Math.floor(nextRandom(state) * (index + 1));
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  }
  return ordered;
}
