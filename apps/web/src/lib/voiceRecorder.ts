import { useCallback, useEffect, useRef, useState } from "react";

const TARGET_SAMPLE_RATE_HZ = 24_000;
const PROCESSOR_BUFFER_SIZE = 4_096;

export interface VoiceRecordingPayload {
  readonly audioBase64: string;
  readonly mimeType: "audio/wav";
  readonly sampleRateHz: number;
  readonly durationMs: number;
}

interface RecorderRuntime {
  readonly audioContext: AudioContext;
  readonly sourceNode: MediaStreamAudioSourceNode;
  readonly processorNode: ScriptProcessorNode;
  readonly silentGainNode: GainNode;
  readonly stream: MediaStream;
  readonly chunks: Float32Array[];
  readonly startedAt: number;
  sampleRateHz: number;
}

export function formatVoiceRecordingDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function useVoiceRecorder() {
  const runtimeRef = useRef<RecorderRuntime | null>(null);
  const timerRef = useRef<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [durationMs, setDurationMs] = useState(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const teardownRuntime = useCallback(async () => {
    const runtime = runtimeRef.current;
    runtimeRef.current = null;
    clearTimer();
    setIsRecording(false);

    if (!runtime) {
      setDurationMs(0);
      return null;
    }

    runtime.processorNode.onaudioprocess = null;
    runtime.sourceNode.disconnect();
    runtime.processorNode.disconnect();
    runtime.silentGainNode.disconnect();
    runtime.stream.getTracks().forEach((track) => track.stop());
    await runtime.audioContext.close().catch(() => undefined);

    const sampleRateHz = runtime.sampleRateHz;
    const elapsedDurationMs = Math.max(0, performance.now() - runtime.startedAt);
    setDurationMs(0);

    return {
      chunks: runtime.chunks,
      sampleRateHz,
      durationMs: elapsedDurationMs,
    };
  }, [clearTimer]);

  const startRecording = useCallback(async () => {
    if (runtimeRef.current) {
      throw new Error("Voice recording is already running.");
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone recording is unavailable in this browser.");
    }

    let stream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let sourceNode: MediaStreamAudioSourceNode | null = null;
    let processorNode: ScriptProcessorNode | null = null;
    let silentGainNode: GainNode | null = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      audioContext = new AudioContext();
      await audioContext.resume();

      sourceNode = audioContext.createMediaStreamSource(stream);
      processorNode = audioContext.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
      silentGainNode = audioContext.createGain();
      silentGainNode.gain.value = 0;

      const runtime: RecorderRuntime = {
        audioContext,
        sourceNode,
        processorNode,
        silentGainNode,
        stream,
        chunks: [],
        startedAt: performance.now(),
        sampleRateHz: audioContext.sampleRate,
      };

      processorNode.onaudioprocess = (event) => {
        const inputBuffer = event.inputBuffer;
        const channelCount = inputBuffer.numberOfChannels;
        const frameCount = inputBuffer.length;
        const monoSamples = new Float32Array(frameCount);

        for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
          const channelData = inputBuffer.getChannelData(channelIndex);
          for (let sampleIndex = 0; sampleIndex < frameCount; sampleIndex += 1) {
            monoSamples[sampleIndex] =
              (monoSamples[sampleIndex] ?? 0) + (channelData[sampleIndex] ?? 0);
          }
        }

        const channelNormalizer = channelCount > 0 ? channelCount : 1;
        for (let sampleIndex = 0; sampleIndex < frameCount; sampleIndex += 1) {
          monoSamples[sampleIndex] = (monoSamples[sampleIndex] ?? 0) / channelNormalizer;
        }

        runtime.chunks.push(monoSamples);
      };

      sourceNode.connect(processorNode);
      processorNode.connect(silentGainNode);
      silentGainNode.connect(audioContext.destination);

      runtimeRef.current = runtime;
      setDurationMs(0);
      setIsRecording(true);
      timerRef.current = window.setInterval(() => {
        const activeRuntime = runtimeRef.current;
        if (!activeRuntime) {
          return;
        }
        setDurationMs(Math.max(0, performance.now() - activeRuntime.startedAt));
      }, 200);
    } catch (error) {
      processorNode?.disconnect();
      sourceNode?.disconnect();
      silentGainNode?.disconnect();
      stream?.getTracks().forEach((track) => track.stop());
      await audioContext?.close().catch(() => undefined);
      throw error;
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<VoiceRecordingPayload | null> => {
    const recorded = await teardownRuntime();
    if (!recorded) {
      return null;
    }

    const mergedSamples = mergeFloat32Chunks(recorded.chunks);
    if (mergedSamples.length === 0) {
      return null;
    }

    const resampledSamples = resampleLinear(
      mergedSamples,
      recorded.sampleRateHz,
      TARGET_SAMPLE_RATE_HZ,
    );
    if (resampledSamples.length === 0) {
      return null;
    }

    const wavBytes = encodeMono16BitWav(resampledSamples, TARGET_SAMPLE_RATE_HZ);
    const wavBuffer = new ArrayBuffer(wavBytes.byteLength);
    new Uint8Array(wavBuffer).set(wavBytes);
    const audioBase64 = await blobToBase64(new Blob([wavBuffer], { type: "audio/wav" }));

    return {
      audioBase64,
      mimeType: "audio/wav",
      sampleRateHz: TARGET_SAMPLE_RATE_HZ,
      durationMs: Math.max(
        1,
        Math.round((resampledSamples.length / TARGET_SAMPLE_RATE_HZ) * 1_000) ||
          recorded.durationMs,
      ),
    };
  }, [teardownRuntime]);

  const cancelRecording = useCallback(async () => {
    await teardownRuntime();
  }, [teardownRuntime]);

  useEffect(
    () => () => {
      void teardownRuntime();
    },
    [teardownRuntime],
  );

  return {
    isRecording,
    durationMs,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}

function mergeFloat32Chunks(chunks: readonly Float32Array[]): Float32Array {
  let totalLength = 0;
  for (const chunk of chunks) {
    totalLength += chunk.length;
  }

  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function resampleLinear(
  samples: Float32Array,
  inputSampleRateHz: number,
  outputSampleRateHz: number,
): Float32Array {
  if (samples.length === 0) {
    return samples;
  }
  if (inputSampleRateHz === outputSampleRateHz) {
    return samples;
  }

  const outputLength = Math.max(
    1,
    Math.round(samples.length * (outputSampleRateHz / inputSampleRateHz)),
  );
  const output = new Float32Array(outputLength);
  const sampleRatio = inputSampleRateHz / outputSampleRateHz;

  for (let index = 0; index < outputLength; index += 1) {
    const position = index * sampleRatio;
    const leftIndex = Math.floor(position);
    const rightIndex = Math.min(samples.length - 1, leftIndex + 1);
    const interpolation = position - leftIndex;
    const leftSample = samples[leftIndex] ?? 0;
    const rightSample = samples[rightIndex] ?? leftSample;
    output[index] = leftSample + (rightSample - leftSample) * interpolation;
  }

  return output;
}

function encodeMono16BitWav(samples: Float32Array, sampleRateHz: number): Uint8Array {
  const bytesPerSample = 2;
  const dataLength = samples.length * bytesPerSample;
  const wavBuffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(wavBuffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, sampleRateHz * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = clampToSignedUnit(samples[index] ?? 0);
    view.setInt16(offset, Math.round(sample * 0x7fff), true);
    offset += bytesPerSample;
  }

  return new Uint8Array(wavBuffer);
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

function clampToSignedUnit(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.max(-1, Math.min(1, value));
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Could not encode the recorded audio."));
        return;
      }
      const [, base64 = ""] = reader.result.split(",", 2);
      if (!base64) {
        reject(new Error("Could not encode the recorded audio."));
        return;
      }
      resolve(base64);
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Could not encode the recorded audio."));
    });
    reader.readAsDataURL(blob);
  });
}
