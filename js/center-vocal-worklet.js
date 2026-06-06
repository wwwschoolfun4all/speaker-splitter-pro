class CenterVocalProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || input.length === 0 || !output || output.length === 0) {
      return true;
    }

    const left = input[0];
    const right = input[1] || left;
    const outLeft = output[0];
    const outRight = output[1] || outLeft;

    // Browser-only vocal isolation is a center-channel extraction pass. It is
    // intentionally light so it can run live without a cloud model or backend.
    for (let i = 0; i < outLeft.length; i += 1) {
      const center = (left[i] + right[i]) * 0.5;
      outLeft[i] = center;
      outRight[i] = center;
    }

    return true;
  }
}

registerProcessor("center-vocal-processor", CenterVocalProcessor);
