/*
 * SoundTouch JS v0.2.1 audio processing library
 * Copyright (c) Olli Parviainen
 * Copyright (c) Ryan Berdeen
 * Copyright (c) Jakub Fiala
 * Copyright (c) Steve 'Cutter' Blades
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2.1 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this library; if not, write to the Free Software
 * Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA  02111-1307  USA
 */

class FifoSampleBuffer {
    constructor() {
        this._vector = new Float32Array();
        this._position = 0;
        this._frameCount = 0;
    }

    get vector() {
        return this._vector;
    }

    get position() {
        return this._position;
    }

    get startIndex() {
        return this._position * 2;
    }

    get frameCount() {
        return this._frameCount;
    }

    get endIndex() {
        return (this._position + this._frameCount) * 2;
    }

    clear() {
        this.receive(this._frameCount);
        this.rewind();
    }

    put(numFrames) {
        this._frameCount += numFrames;
    }

    putSamples(samples, position, numFrames = 0) {
        position = position || 0;
        const sourceOffset = position * 2;
        if (!(numFrames >= 0)) {
            numFrames = (samples.length - sourceOffset) / 2;
        }
        const numSamples = numFrames * 2;
        this.ensureCapacity(numFrames + this._frameCount);
        const destOffset = this.endIndex;
        this.vector.set(samples.subarray(sourceOffset, sourceOffset + numSamples), destOffset);
        this._frameCount += numFrames;
    }

    putBuffer(buffer, position, numFrames = 0) {
        position = position || 0;
        if (!(numFrames >= 0)) {
            numFrames = buffer.frameCount - position;
        }
        this.putSamples(buffer.vector, buffer.position + position, numFrames);
    }

    receive(numFrames) {
        if (!(numFrames >= 0) || numFrames > this._frameCount) {
            numFrames = this.frameCount;
        }
        this._frameCount -= numFrames;
        this._position += numFrames;
    }

    receiveSamples(output, numFrames = 0) {
        const numSamples = numFrames * 2;
        const sourceOffset = this.startIndex;
        output.set(this._vector.subarray(sourceOffset, sourceOffset + numSamples));
        this.receive(numFrames);
    }

    extract(output, position = 0, numFrames = 0) {
        const sourceOffset = this.startIndex + position * 2;
        const numSamples = numFrames * 2;
        output.set(this._vector.subarray(sourceOffset, sourceOffset + numSamples));
    }

    ensureCapacity(numFrames = 0) {
        const minLength = parseInt(numFrames * 2);
        if (this._vector.length < minLength) {
            const newVector = new Float32Array(minLength);
            newVector.set(this._vector.subarray(this.startIndex, this.endIndex));
            this._vector = newVector;
            this._position = 0;
        } else {
            this.rewind();
        }
    }

    ensureAdditionalCapacity(numFrames = 0) {
        this.ensureCapacity(this._frameCount + numFrames);
    }

    rewind() {
        if (this._position > 0) {
            this._vector.set(this._vector.subarray(this.startIndex, this.endIndex));
            this._position = 0;
        }
    }
}

class AbstractFifoSamplePipe {
    constructor(createBuffers) {
        if (createBuffers) {
            this._inputBuffer = new FifoSampleBuffer();
            this._outputBuffer = new FifoSampleBuffer();
        } else {
            this._inputBuffer = this._outputBuffer = null;
        }
    }

    get inputBuffer() {
        return this._inputBuffer;
    }

    set inputBuffer(inputBuffer) {
        this._inputBuffer = inputBuffer;
    }

    get outputBuffer() {
        return this._outputBuffer;
    }

    set outputBuffer(outputBuffer) {
        this._outputBuffer = outputBuffer;
    }

    clear() {
        this._inputBuffer.clear();
        this._outputBuffer.clear();
    }
}

class RateTransposer extends AbstractFifoSamplePipe {
    constructor(createBuffers) {
        super(createBuffers);
        this.reset();
        this._rate = 1;
    }

    set rate(rate) {
        this._rate = rate;
    }

    reset() {
        this.slopeCount = 0;
        this.prevSampleL = 0;
        this.prevSampleR = 0;
        this._aaLastRate = 0;
        this._aaX1L = 0; this._aaX2L = 0;
        this._aaY1L = 0; this._aaY2L = 0;
        this._aaX1R = 0; this._aaX2R = 0;
        this._aaY1R = 0; this._aaY2R = 0;
    }

    clone() {
        const result = new RateTransposer();
        result.rate = this._rate;
        return result;
    }

    process() {
        const numFrames = this._inputBuffer.frameCount;
        this._outputBuffer.ensureAdditionalCapacity(numFrames / this._rate + 1);
        if (this._rate > 1.0) {
            this._applyAntiAlias(numFrames);
        }
        const numFramesOutput = this.transpose(numFrames);
        this._inputBuffer.receive();
        this._outputBuffer.put(numFramesOutput);
    }

    _applyAntiAlias(numFrames) {
        if (this._rate <= 1.0) return;
        const src = this._inputBuffer.vector;
        const offset = this._inputBuffer.startIndex;

        if (this._rate !== this._aaLastRate) {
            const w0 = Math.PI / this._rate;
            const cosw0 = Math.cos(w0);
            const sinw0 = Math.sin(w0);
            const alpha = sinw0 / 1.414;
            const a0 = 1 + alpha;
            this._aa_b0 = (1 - cosw0) / (2 * a0);
            this._aa_b1 = (1 - cosw0) / a0;
            this._aa_b2 = this._aa_b0;
            this._aa_a1 = (-2 * cosw0) / a0;
            this._aa_a2 = (1 - alpha) / a0;
            this._aaLastRate = this._rate;
        }

        for (let i = 0; i < numFrames; i++) {
            const idx = offset + 2 * i;
            const inL = src[idx];
            const inR = src[idx + 1];
            const outL = this._aa_b0 * inL + this._aa_b1 * this._aaX1L + this._aa_b2 * this._aaX2L
                       - this._aa_a1 * this._aaY1L - this._aa_a2 * this._aaY2L;
            const outR = this._aa_b0 * inR + this._aa_b1 * this._aaX1R + this._aa_b2 * this._aaX2R
                       - this._aa_a1 * this._aaY1R - this._aa_a2 * this._aaY2R;
            this._aaX2L = this._aaX1L; this._aaX1L = inL;
            this._aaY2L = this._aaY1L; this._aaY1L = outL;
            this._aaX2R = this._aaX1R; this._aaX1R = inR;
            this._aaY2R = this._aaY1R; this._aaY1R = outR;
            src[idx] = outL;
            src[idx + 1] = outR;
        }
    }

    transpose(numFrames = 0) {
        if (numFrames === 0) {
            return 0;
        }
        const src = this._inputBuffer.vector;
        const srcOffset = this._inputBuffer.startIndex;
        const dest = this._outputBuffer.vector;
        const destOffset = this._outputBuffer.endIndex;
        let used = 0;
        let i = 0;
        while (this.slopeCount < 1.0) {
            dest[destOffset + 2 * i] = (1.0 - this.slopeCount) * this.prevSampleL + this.slopeCount * src[srcOffset];
            dest[destOffset + 2 * i + 1] = (1.0 - this.slopeCount) * this.prevSampleR + this.slopeCount * src[srcOffset + 1];
            i = i + 1;
            this.slopeCount += this._rate;
        }
        this.slopeCount -= 1.0;
        if (numFrames !== 1) {
            out: while (true) {
                while (this.slopeCount > 1.0) {
                    this.slopeCount -= 1.0;
                    used = used + 1;
                    if (used >= numFrames - 1) {
                        break out;
                    }
                }
                const srcIndex = srcOffset + 2 * used;
                if (used >= 1 && used < numFrames - 2) {
                    const t = this.slopeCount;
                    const t2 = t * t;
                    const t3 = t2 * t;
                    dest[destOffset + 2 * i] = 0.5 * (
                        (2 * src[srcIndex]) +
                        (-src[srcIndex - 2] + src[srcIndex + 2]) * t +
                        (2 * src[srcIndex - 2] - 5 * src[srcIndex] + 4 * src[srcIndex + 2] - src[srcIndex + 4]) * t2 +
                        (-src[srcIndex - 2] + 3 * src[srcIndex] - 3 * src[srcIndex + 2] + src[srcIndex + 4]) * t3
                    );
                    dest[destOffset + 2 * i + 1] = 0.5 * (
                        (2 * src[srcIndex + 1]) +
                        (-src[srcIndex - 1] + src[srcIndex + 3]) * t +
                        (2 * src[srcIndex - 1] - 5 * src[srcIndex + 1] + 4 * src[srcIndex + 3] - src[srcIndex + 5]) * t2 +
                        (-src[srcIndex - 1] + 3 * src[srcIndex + 1] - 3 * src[srcIndex + 3] + src[srcIndex + 5]) * t3
                    );
                } else {
                    dest[destOffset + 2 * i] = (1.0 - this.slopeCount) * src[srcIndex] + this.slopeCount * src[srcIndex + 2];
                    dest[destOffset + 2 * i + 1] = (1.0 - this.slopeCount) * src[srcIndex + 1] + this.slopeCount * src[srcIndex + 3];
                }
                i = i + 1;
                this.slopeCount += this._rate;
            }
        }
        this.prevSampleL = src[srcOffset + 2 * numFrames - 2];
        this.prevSampleR = src[srcOffset + 2 * numFrames - 1];
        return i;
    }
}

class FilterSupport {
    constructor(pipe) {
        this._pipe = pipe;
    }

    get pipe() {
        return this._pipe;
    }

    get inputBuffer() {
        return this._pipe.inputBuffer;
    }

    get outputBuffer() {
        return this._pipe.outputBuffer;
    }

    fillInputBuffer() {
        throw new Error('fillInputBuffer() not overridden');
    }

    fillOutputBuffer(numFrames = 0) {
        while (this.outputBuffer.frameCount < numFrames) {
            const numInputFrames = 8192 * 2 - this.inputBuffer.frameCount;
            this.fillInputBuffer(numInputFrames);
            if (this.inputBuffer.frameCount < 8192 * 2) {
                break;
            }
            this._pipe.process();
        }
    }

    clear() {
        this._pipe.clear();
    }
}

const noop = function () {
    return;
};

class SimpleFilter extends FilterSupport {
    constructor(sourceSound, pipe, callback = noop) {
        super(pipe);
        this.callback = callback;
        this.sourceSound = sourceSound;
        this.historyBufferSize = 22050;
        this._sourcePosition = 0;
        this.outputBufferPosition = 0;
        this._position = 0;
        this._preFilterPitch = 1.0;
        this._pfLastRate = 0;
        this._pfX1L = 0; this._pfX2L = 0;
        this._pfY1L = 0; this._pfY2L = 0;
        this._pfX1R = 0; this._pfX2R = 0;
        this._pfY1R = 0; this._pfY2R = 0;
    }

    set pitch(p) {
        this._preFilterPitch = p;
    }

    get position() {
        return this._position;
    }

    set position(position) {
        if (position > this._position) {
            throw new RangeError('New position may not be greater than current position');
        }
        const newOutputBufferPosition = this.outputBufferPosition - (this._position - position);
        if (newOutputBufferPosition < 0) {
            throw new RangeError('New position falls outside of history buffer');
        }
        this.outputBufferPosition = newOutputBufferPosition;
        this._position = position;
    }

    get sourcePosition() {
        return this._sourcePosition;
    }

    set sourcePosition(sourcePosition) {
        this.clear();
        this._sourcePosition = sourcePosition;
    }

    onEnd() {
        this.callback();
    }

    fillInputBuffer(numFrames = 0) {
        const samples = new Float32Array(numFrames * 2);
        const numFramesExtracted = this.sourceSound.extract(samples, numFrames, this._sourcePosition);
        this._sourcePosition += numFramesExtracted;
        if (this._preFilterPitch > 1.0 && numFramesExtracted > 0) {
            this._applyPreFilter(samples, numFramesExtracted);
        }
        this.inputBuffer.putSamples(samples, 0, numFramesExtracted);
    }

    _applyPreFilter(samples, numFrames) {
        const fs = 44100;
        const fc = fs / (2.5 * this._preFilterPitch);
        const w0 = 2 * Math.PI * fc / fs;
        const cosw0 = Math.cos(w0);
        const sinw0 = Math.sin(w0);
        const alpha = sinw0 / 1.414;
        const a0 = 1 + alpha;
        const b0 = (1 - cosw0) / (2 * a0);
        const b1 = (1 - cosw0) / a0;
        const b2 = b0;
        const a1 = (-2 * cosw0) / a0;
        const a2 = (1 - alpha) / a0;
        for (let i = 0; i < numFrames; i++) {
            const idx = 2 * i;
            const inL = samples[idx];
            const inR = samples[idx + 1];
            const outL = b0 * inL + b1 * this._pfX1L + b2 * this._pfX2L
                       - a1 * this._pfY1L - a2 * this._pfY2L;
            const outR = b0 * inR + b1 * this._pfX1R + b2 * this._pfX2R
                       - a1 * this._pfY1R - a2 * this._pfY2R;
            this._pfX2L = this._pfX1L; this._pfX1L = inL;
            this._pfY2L = this._pfY1L; this._pfY1L = outL;
            this._pfX2R = this._pfX1R; this._pfX1R = inR;
            this._pfY2R = this._pfY1R; this._pfY1R = outR;
            samples[idx] = outL;
            samples[idx + 1] = outR;
        }
    }

    extract(target, numFrames = 0) {
        this.fillOutputBuffer(this.outputBufferPosition + numFrames);
        const numFramesExtracted = Math.min(numFrames, this.outputBuffer.frameCount - this.outputBufferPosition);
        this.outputBuffer.extract(target, this.outputBufferPosition, numFramesExtracted);
        const currentFrames = this.outputBufferPosition + numFramesExtracted;
        this.outputBufferPosition = Math.min(this.historyBufferSize, currentFrames);
        this.outputBuffer.receive(Math.max(currentFrames - this.historyBufferSize, 0));
        this._position += numFramesExtracted;
        return numFramesExtracted;
    }

    handleSampleData(event) {
        this.extract(event.data, 4096);
    }

    clear() {
        super.clear();
        this.outputBufferPosition = 0;
        this._pfX1L = 0; this._pfX2L = 0;
        this._pfY1L = 0; this._pfY2L = 0;
        this._pfX1R = 0; this._pfX2R = 0;
        this._pfY1R = 0; this._pfY2R = 0;
    }
}

const USE_AUTO_SEQUENCE_LEN = 0;
const DEFAULT_SEQUENCE_MS = USE_AUTO_SEQUENCE_LEN;
const USE_AUTO_SEEKWINDOW_LEN = 0;
const DEFAULT_SEEKWINDOW_MS = USE_AUTO_SEEKWINDOW_LEN;
const DEFAULT_OVERLAP_MS = 16;
const _SCAN_OFFSETS = [[124, 186, 248, 310, 372, 434, 496, 558, 620, 682, 744, 806, 868, 930, 992, 1054, 1116, 1178, 1240, 1302, 1364, 1426, 1488, 0], [-100, -75, -50, -25, 25, 50, 75, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [-20, -15, -10, -5, 5, 10, 15, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [-4, -3, -2, -1, 1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]];
const AUTOSEQ_TEMPO_LOW = 0.25;
const AUTOSEQ_TEMPO_TOP = 4.0;
const AUTOSEQ_AT_MIN = 125.0;
const AUTOSEQ_AT_MAX = 50.0;
const AUTOSEQ_K = (AUTOSEQ_AT_MAX - AUTOSEQ_AT_MIN) / (AUTOSEQ_TEMPO_TOP - AUTOSEQ_TEMPO_LOW);
const AUTOSEQ_C = AUTOSEQ_AT_MIN - AUTOSEQ_K * AUTOSEQ_TEMPO_LOW;
const AUTOSEEK_AT_MIN = 25.0;
const AUTOSEEK_AT_MAX = 15.0;
const AUTOSEEK_K = (AUTOSEEK_AT_MAX - AUTOSEEK_AT_MIN) / (AUTOSEQ_TEMPO_TOP - AUTOSEQ_TEMPO_LOW);
const AUTOSEEK_C = AUTOSEEK_AT_MIN - AUTOSEEK_K * AUTOSEQ_TEMPO_LOW;

class Stretch extends AbstractFifoSamplePipe {
    constructor(createBuffers) {
        super(createBuffers);
        this._quickSeek = true;
        this.midBufferDirty = false;
        this.midBuffer = null;
        this.overlapLength = 0;
        this.autoSeqSetting = true;
        this.autoSeekSetting = true;
        this._tempo = 1;
        this.setParameters(44100, DEFAULT_SEQUENCE_MS, DEFAULT_SEEKWINDOW_MS, DEFAULT_OVERLAP_MS);
    }

    clear() {
        super.clear();
        this.clearMidBuffer();
    }

    clearMidBuffer() {
        if (this.midBufferDirty) {
            this.midBufferDirty = false;
            this.midBuffer = null;
        }
    }

    setParameters(sampleRate, sequenceMs, seekWindowMs, overlapMs) {
        if (sampleRate > 0) {
            this.sampleRate = sampleRate;
        }
        if (overlapMs > 0) {
            this.overlapMs = overlapMs;
        }
        if (sequenceMs > 0) {
            this.sequenceMs = sequenceMs;
            this.autoSeqSetting = false;
        } else {
            this.autoSeqSetting = true;
        }
        if (seekWindowMs > 0) {
            this.seekWindowMs = seekWindowMs;
            this.autoSeekSetting = false;
        } else {
            this.autoSeekSetting = true;
        }
        this.calculateSequenceParameters();
        this.calculateOverlapLength(this.overlapMs);
        this.tempo = this._tempo;
    }

    set tempo(newTempo) {
        let intskip;
        this._tempo = newTempo;
        this.calculateSequenceParameters();
        this.nominalSkip = this._tempo * (this.seekWindowLength - this.overlapLength);
        this.skipFract = 0;
        intskip = Math.floor(this.nominalSkip + 0.5);
        this.sampleReq = Math.max(intskip + this.overlapLength, this.seekWindowLength) + this.seekLength;
    }

    get tempo() {
        return this._tempo;
    }

    get inputChunkSize() {
        return this.sampleReq;
    }

    get outputChunkSize() {
        return this.overlapLength + Math.max(0, this.seekWindowLength - 2 * this.overlapLength);
    }

    calculateOverlapLength(overlapInMsec = 0) {
        let newOvl;
        newOvl = this.sampleRate * overlapInMsec / 1000;
        newOvl = newOvl < 16 ? 16 : newOvl;
        newOvl -= newOvl % 8;
        this.overlapLength = newOvl;
        this.refMidBuffer = new Float32Array(this.overlapLength * 2);
        this.midBuffer = new Float32Array(this.overlapLength * 2);
    }

    checkLimits(x, mi, ma) {
        return x < mi ? mi : x > ma ? ma : x;
    }

    calculateSequenceParameters() {
        let seq;
        let seek;
        if (this.autoSeqSetting) {
            seq = AUTOSEQ_C + AUTOSEQ_K * this._tempo;
            seq = this.checkLimits(seq, AUTOSEQ_AT_MAX, AUTOSEQ_AT_MIN);
            this.sequenceMs = Math.floor(seq + 0.5);
        }
        if (this.autoSeekSetting) {
            seek = AUTOSEEK_C + AUTOSEEK_K * this._tempo;
            seek = this.checkLimits(seek, AUTOSEEK_AT_MAX, AUTOSEEK_AT_MIN);
            this.seekWindowMs = Math.floor(seek + 0.5);
        }
        this.seekWindowLength = Math.floor(this.sampleRate * this.sequenceMs / 1000);
        this.seekLength = Math.floor(this.sampleRate * this.seekWindowMs / 1000);
    }

    set quickSeek(enable) {
        this._quickSeek = enable;
    }

    clone() {
        const result = new Stretch();
        result.tempo = this._tempo;
        result.setParameters(this.sampleRate, this.sequenceMs, this.seekWindowMs, this.overlapMs);
        return result;
    }

    seekBestOverlapPosition() {
        return this._quickSeek ? this.seekBestOverlapPositionStereoQuick() : this.seekBestOverlapPositionStereo();
    }

    seekBestOverlapPositionStereo() {
        let bestOffset;
        let bestCorrelation;
        let correlation;
        let i = 0;
        this.preCalculateCorrelationReferenceStereo();
        bestOffset = 0;
        bestCorrelation = Number.MIN_VALUE;
        for (; i < this.seekLength; i = i + 1) {
            correlation = this.calculateCrossCorrelationStereo(2 * i, this.refMidBuffer);
            if (correlation > bestCorrelation) {
                bestCorrelation = correlation;
                bestOffset = i;
            }
        }
        return bestOffset;
    }

    seekBestOverlapPositionStereoQuick() {
        let bestOffset;
        let bestCorrelation;
        let correlation;
        let scanCount = 0;
        let correlationOffset;
        let tempOffset;
        this.preCalculateCorrelationReferenceStereo();
        bestCorrelation = Number.MIN_VALUE;
        bestOffset = 0;
        correlationOffset = 0;
        tempOffset = 0;
        for (; scanCount < 4; scanCount = scanCount + 1) {
            let j = 0;
            while (_SCAN_OFFSETS[scanCount][j]) {
                tempOffset = correlationOffset + _SCAN_OFFSETS[scanCount][j];
                if (tempOffset >= this.seekLength) {
                    break;
                }
                correlation = this.calculateCrossCorrelationStereo(2 * tempOffset, this.refMidBuffer);
                if (correlation > bestCorrelation) {
                    bestCorrelation = correlation;
                    bestOffset = tempOffset;
                }
                j = j + 1;
            }
            correlationOffset = bestOffset;
        }
        return bestOffset;
    }

    preCalculateCorrelationReferenceStereo() {
        let i = 0;
        let context;
        let temp;
        for (; i < this.overlapLength; i = i + 1) {
            temp = i * (this.overlapLength - i);
            context = i * 2;
            this.refMidBuffer[context] = this.midBuffer[context] * temp;
            this.refMidBuffer[context + 1] = this.midBuffer[context + 1] * temp;
        }
    }

    calculateCrossCorrelationStereo(mixingPosition, compare) {
        const mixing = this._inputBuffer.vector;
        mixingPosition += this._inputBuffer.startIndex;
        let correlation = 0;
        let i = 2;
        const calcLength = 2 * this.overlapLength;
        let mixingOffset;
        for (; i < calcLength; i = i + 2) {
            mixingOffset = i + mixingPosition;
            correlation += mixing[mixingOffset] * compare[i] + mixing[mixingOffset + 1] * compare[i + 1];
        }
        return correlation;
    }

    overlap(overlapPosition) {
        this.overlapStereo(2 * overlapPosition);
    }

    overlapStereo(inputPosition) {
        const input = this._inputBuffer.vector;
        inputPosition += this._inputBuffer.startIndex;
        const output = this._outputBuffer.vector;
        const outputPosition = this._outputBuffer.endIndex;
        let i = 0;
        let context;
        let tempFrame;
        let fi;
        let inputOffset;
        let outputOffset;
        for (; i < this.overlapLength; i = i + 1) {
            fi = 0.5 * (1 - Math.cos(Math.PI * i / this.overlapLength));
            tempFrame = 1 - fi;
            context = 2 * i;
            inputOffset = context + inputPosition;
            outputOffset = context + outputPosition;
            output[outputOffset + 0] = input[inputOffset + 0] * fi + this.midBuffer[context + 0] * tempFrame;
            output[outputOffset + 1] = input[inputOffset + 1] * fi + this.midBuffer[context + 1] * tempFrame;
        }
    }

    process() {
        let offset;
        let temp;
        let overlapSkip;
        if (this.midBuffer === null) {
            if (this._inputBuffer.frameCount < this.overlapLength) {
                return;
            }
            this.midBuffer = new Float32Array(this.overlapLength * 2);
            this._inputBuffer.receiveSamples(this.midBuffer, this.overlapLength);
        }
        while (this._inputBuffer.frameCount >= this.sampleReq) {
            offset = this.seekBestOverlapPosition();
            this._outputBuffer.ensureAdditionalCapacity(this.overlapLength);
            this.overlap(Math.floor(offset));
            this._outputBuffer.put(this.overlapLength);
            temp = this.seekWindowLength - 2 * this.overlapLength;
            if (temp > 0) {
                this._outputBuffer.putBuffer(this._inputBuffer, offset + this.overlapLength, temp);
            }
            const start = this._inputBuffer.startIndex + 2 * (offset + this.seekWindowLength - this.overlapLength);
            this.midBuffer.set(this._inputBuffer.vector.subarray(start, start + 2 * this.overlapLength));
            this.skipFract += this.nominalSkip;
            overlapSkip = Math.floor(this.skipFract);
            this.skipFract -= overlapSkip;
            this._inputBuffer.receive(overlapSkip);
        }
    }
}

const testFloatEqual = function (a, b) {
    return (a > b ? a - b : b - a) > 1e-10;
};

class SoundTouch {
    constructor() {
        this.transposer = new RateTransposer(false);
        this.stretch = new Stretch(false);
        this._inputBuffer = new FifoSampleBuffer();
        this._intermediateBuffer = new FifoSampleBuffer();
        this._outputBuffer = new FifoSampleBuffer();
        this._rate = 0;
        this._tempo = 0;
        this.virtualPitch = 1.0;
        this.virtualRate = 1.0;
        this.virtualTempo = 1.0;
        this.calculateEffectiveRateAndTempo();
    }

    clear() {
        this.transposer.clear();
        this.stretch.clear();
    }

    clone() {
        const result = new SoundTouch();
        result.rate = this.rate;
        result.tempo = this.tempo;
        return result;
    }

    get rate() {
        return this._rate;
    }

    set rate(rate) {
        this.virtualRate = rate;
        this.calculateEffectiveRateAndTempo();
    }

    set rateChange(rateChange) {
        this._rate = 1.0 + 0.01 * rateChange;
    }

    get tempo() {
        return this._tempo;
    }

    set tempo(tempo) {
        this.virtualTempo = tempo;
        this.calculateEffectiveRateAndTempo();
    }

    set tempoChange(tempoChange) {
        this.tempo = 1.0 + 0.01 * tempoChange;
    }

    set pitch(pitch) {
        this.virtualPitch = pitch;
        this.calculateEffectiveRateAndTempo();
    }

    set pitchOctaves(pitchOctaves) {
        this.pitch = Math.exp(0.69314718056 * pitchOctaves);
        this.calculateEffectiveRateAndTempo();
    }

    set pitchSemitones(pitchSemitones) {
        this.pitchOctaves = pitchSemitones / 12.0;
    }

    get inputBuffer() {
        return this._inputBuffer;
    }

    get outputBuffer() {
        return this._outputBuffer;
    }

    calculateEffectiveRateAndTempo() {
        const previousTempo = this._tempo;
        const previousRate = this._rate;
        this._tempo = this.virtualTempo / this.virtualPitch;
        this._rate = this.virtualRate * this.virtualPitch;
        if (testFloatEqual(this._tempo, previousTempo)) {
            this.stretch.tempo = this._tempo;
        }
        if (testFloatEqual(this._rate, previousRate)) {
            this.transposer.rate = this._rate;
        }
        if (this._rate > 1.0) {
            if (this._outputBuffer != this.transposer.outputBuffer) {
                this.stretch.inputBuffer = this._inputBuffer;
                this.stretch.outputBuffer = this._intermediateBuffer;
                this.transposer.inputBuffer = this._intermediateBuffer;
                this.transposer.outputBuffer = this._outputBuffer;
            }
        } else {
            if (this._outputBuffer != this.stretch.outputBuffer) {
                this.transposer.inputBuffer = this._inputBuffer;
                this.transposer.outputBuffer = this._intermediateBuffer;
                this.stretch.inputBuffer = this._intermediateBuffer;
                this.stretch.outputBuffer = this._outputBuffer;
            }
        }
        this.stretch.quickSeek = this.virtualPitch <= 1.189207115;
    }

    process() {
        if (this._rate > 1.0) {
            this.stretch.process();
            this.transposer.process();
        } else {
            this.transposer.process();
            this.stretch.process();
        }
    }
}

class WebAudioBufferSource {
    constructor(buffer) {
        this.buffer = buffer;
        this._position = 0;
    }

    get dualChannel() {
        return this.buffer.numberOfChannels > 1;
    }

    get position() {
        return this._position;
    }

    set position(value) {
        this._position = value;
    }

    extract(target, numFrames = 0, position = 0) {
        this.position = position;
        let left = this.buffer.getChannelData(0);
        let right = this.dualChannel ? this.buffer.getChannelData(1) : this.buffer.getChannelData(0);
        let i = 0;
        for (; i < numFrames; i++) {
            target[i * 2] = left[i + position];
            target[i * 2 + 1] = right[i + position];
        }
        return Math.min(numFrames, left.length - position);
    }
}

const getWebAudioNode = function (context, filter, sourcePositionCallback = noop, bufferSize = 4096) {
    const node = context.createScriptProcessor(bufferSize, 2, 2);
    const samples = new Float32Array(bufferSize * 2);
    node.onaudioprocess = event => {
        let left = event.outputBuffer.getChannelData(0);
        let right = event.outputBuffer.getChannelData(1);
        let framesExtracted = filter.extract(samples, bufferSize);
        sourcePositionCallback(filter.sourcePosition);
        if (framesExtracted === 0) {
            filter.onEnd();
        }
        let i = 0;
        for (; i < framesExtracted; i++) {
            left[i] = samples[i * 2];
            right[i] = samples[i * 2 + 1];
        }
    };
    return node;
};

const pad = function (n, width, z) {
    z = z || '0';
    n = n + '';
    return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
};
const minsSecs = function (secs) {
    const mins = Math.floor(secs / 60);
    const seconds = secs - mins * 60;
    return `${mins}:${pad(parseInt(seconds), 2)}`;
};

const onUpdate = function (sourcePosition) {
    const currentTimePlayed = this.timePlayed;
    const sampleRate = this.sampleRate;
    this.sourcePosition = sourcePosition;
    this.timePlayed = sourcePosition / sampleRate;
    if (currentTimePlayed !== this.timePlayed) {
        const timePlayed = new CustomEvent('play', {
            detail: {
                timePlayed: this.timePlayed,
                formattedTimePlayed: this.formattedTimePlayed,
                percentagePlayed: this.percentagePlayed
            }
        });
        this._node.dispatchEvent(timePlayed);
    }
};

class PitchShifter {
    constructor(context, buffer, bufferSize, onEnd = noop) {
        this._soundtouch = new SoundTouch();
        const source = new WebAudioBufferSource(buffer);
        this.timePlayed = 0;
        this.sourcePosition = 0;
        this._filter = new SimpleFilter(source, this._soundtouch, onEnd);
        this._node = getWebAudioNode(context, this._filter, sourcePostion => onUpdate.call(this, sourcePostion), bufferSize);
        this.tempo = 1;
        this.rate = 1;
        this.duration = buffer.duration;
        this.sampleRate = context.sampleRate;
        this.listeners = [];
    }

    get formattedDuration() {
        return minsSecs(this.duration);
    }

    get formattedTimePlayed() {
        return minsSecs(this.timePlayed);
    }

    get percentagePlayed() {
        return 100 * this._filter.sourcePosition / (this.duration * this.sampleRate);
    }

    set percentagePlayed(perc) {
        this._filter.sourcePosition = parseInt(perc * this.duration * this.sampleRate);
        this.sourcePosition = this._filter.sourcePosition;
        this.timePlayed = this.sourcePosition / this.sampleRate;
    }

    get node() {
        return this._node;
    }

    set pitch(pitch) {
        this._soundtouch.pitch = pitch;
        this._filter.pitch = pitch;
    }

    set pitchSemitones(semitone) {
        this._soundtouch.pitchSemitones = semitone;
    }

    set rate(rate) {
        this._soundtouch.rate = rate;
    }

    set tempo(tempo) {
        this._soundtouch.tempo = tempo;
    }

    connect(toNode) {
        this._node.connect(toNode);
    }

    disconnect() {
        this._node.disconnect();
    }

    on(eventName, cb) {
        this.listeners.push({
            name: eventName,
            cb: cb
        });
        this._node.addEventListener(eventName, event => cb(event.detail));
    }

    off(eventName = null) {
        let listeners = this.listeners;
        if (eventName) {
            listeners = listeners.filter(e => e.name === eventName);
        }
        listeners.forEach(e => {
            this._node.removeEventListener(e.name, event => e.cb(event.detail));
        });
    }

    stop() {
        // 1. 断开音频连接
        this.disconnect();

        // 2. 关键：移除事件监听器，断开闭包引用
        if (this._node) {
            this._node.onaudioprocess = null; // 必须手动置空，否则会导致严重内存泄漏
            this._node = null;                // 解除节点引用
        }

        // 3. 可选：清空内部大对象引用，加速 GC
        this._filter = null;
        this._soundtouch = null;
        this.listeners = [];
    }
}

//# sourceMappingURL=soundtouch.js.map

// ====================== 音频播放器 ======================
document.addEventListener('DOMContentLoaded', function () {
// 获取 DOM 元素
    const folderInput = document.getElementById('folder-input');
    const singleInput = document.getElementById('single-song-input');
    const dragDropZone = document.getElementById('drag-drop-area');
    const songList = document.getElementById('song-list');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const randomBtn = document.getElementById('random-btn');
    const loopBtn = document.getElementById('loop-btn');
    const pitchShiftSelect = document.getElementById('pitch-shift');
    const tempoShiftSelect = document.getElementById('tempo-shift');
    const pitchShiftVal = document.getElementById('pitch-shift-val');
    const tempoShiftVal = document.getElementById('tempo-shift-val');
    const progress = document.getElementById('progress');
    const progressBar = document.getElementById('progress-bar');
    const playerTitle = document.getElementById('player-title');
    const searchInput = document.getElementById('search-input');
    const deleteSelectedBtn = document.getElementById('delete-selected-btn');
    const multiSelectBtn = document.getElementById('multi-select-btn');
    const selectAllBtn = document.getElementById('select-all-btn');
    const togglePlaylistBtn = document.getElementById('toggle-playlist-btn');
    const sidebarLayout = document.querySelector('.sidebar-layout');

// 全局变量
    let songs = [];
    let currentSongIndex = 0;
    // 当前歌曲的引用，独立于 isPlaying 存在。
    // isPlaying 只是传输状态（暂停时为 false），而 currentSongIndex 只是下标，
    // 一旦 songs 被重排下标就会失效。二者都不足以在列表变更后重新定位当前歌曲，
    // 因此这里用对象引用作为唯一真相来源。
    let currentSong = null;
    let multiSelectMode = false;
    let selectedSongs = new Set();
    let lastSelectedSong = null;
    let isPlaying = false;
    let isLooping = false;
    let isRandom = false;
    let currentSeek = 0;
    let currentPitchShift = 0;
    let currentTempoShift = 1;
    let audioContext = new window.AudioContext(); // 只创建一次 AudioContext
    let analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 256;
    let visualizerCanvas = document.getElementById('visualizer');
    let visualizerCtx = visualizerCanvas ? visualizerCanvas.getContext('2d') : null;
    let visualizerAnimationFrame;
    let visualizerDataArray = null;
    let pitchShifter;
    let gainNode;
    // 淡入/淡出定时器句柄。两者互斥：新的淡变必须取消上一个，
    // 否则暂停后立刻恢复时，旧的淡出定时器仍会把音量拉回 0 并触发回调。
    let fadeInTimer = null;
    let fadeOutTimer = null;
    // 淡出进行中。声音尚未消失，可视化需继续；用于区分"逻辑已暂停"与"视听已静止"
    let isFadingOut = false;
    let loadRequestId = 0;
    // 封面加载令牌。音频路径由 loadRequestId 守卫，封面链路（标签读取 → FileReader
    // → Image.onload）没有对应机制，快速切歌时先返回的旧请求会覆盖新歌曲的
    // 主题色、favicon 与 mediaSession 元数据。
    let coverRequestId = 0;
    // 全局快捷键门控谓词：返回 true 表示本次按键由外部接管
    let shortcutGate = null;
    // 歌曲源处理器：{canHandle(song) -> boolean, play(song) -> void}
    let songSourceHandler = null;
    let currentAlbumColor = null; // null或 "r, g, b"
    let currentDisplayColor = null; // 经过当前明暗主题优化后的展示色
    let activeThemeIndex = 1;     // 用于在主题渐变伪元素之间切换 (1 或 2)
    let allFilesMap = new Map();  // 保存所有文件（包括图片），用于查找封面

    // 更新界面背景渐变
    function updateThemeBackground() {
        if (currentAlbumColor) {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            const isDark = currentTheme === 'dark' || (!currentTheme && isSystemDark);

            // 根据当前主题动态优化颜色，确保充足对比度并且不至于在深色下太刺眼或发黑
            let [r, g, b] = currentAlbumColor.split(',').map(n => parseInt(n.trim(), 10));
            const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

            if (isDark && luminance < 100) {
                // 深色模式下提亮过暗的主题色
                if (luminance < 5) {
                    r = g = b = 100;
                } else {
                    const factor = 100 / luminance;
                    r = Math.min(255, Math.floor(r * factor));
                    g = Math.min(255, Math.floor(g * factor));
                    b = Math.min(255, Math.floor(b * factor));
                }
            } else if (!isDark && luminance > 170) {
                // 浅色模式下压暗过亮的主题色
                const factor = 170 / luminance;
                r = Math.max(0, Math.floor(r * factor));
                g = Math.max(0, Math.floor(g * factor));
                b = Math.max(0, Math.floor(b * factor));
            }

            currentDisplayColor = `${r}, ${g}, ${b}`;

            // 让整个界面的背景色更加饱满与过渡，使全界面透明度更高更明显的渐变适配
            const startOpacity = isDark ? 0.6 : 0.4;
            const endOpacity = isDark ? 0.2 : 0.05;

            // 切换激活的主题层
            const newIndex = activeThemeIndex === 1 ? 2 : 1;

            // 直接拼接生成完整的 linear-gradient 背景，避免在 rgba() 内写 CSS 变量可能产生的解析问题
            const bodyBg = `linear-gradient(135deg, rgba(${currentDisplayColor}, ${startOpacity}) 0%, rgba(${currentDisplayColor}, ${endOpacity}) 100%)`;

            document.documentElement.style.setProperty(`--theme-bg-layer-${newIndex}`, bodyBg);
            document.documentElement.style.setProperty('--theme-color-rgb-current', currentDisplayColor);

            document.documentElement.style.setProperty('--accent', `rgb(${currentDisplayColor})`);
            document.documentElement.style.setProperty('--accent-light', `rgba(${currentDisplayColor}, 0.1)`);
            document.documentElement.style.setProperty('--accent-medium', `rgba(${currentDisplayColor}, 0.2)`);
            document.documentElement.style.setProperty('--accent-hover', `rgba(${currentDisplayColor}, 0.3)`);

            // 切换 Class 触发渐变
            document.body.classList.remove(`theme-bg-${activeThemeIndex}`);
            document.body.classList.add(`theme-bg-${newIndex}`);

            activeThemeIndex = newIndex;

        } else {
            document.body.classList.remove('theme-bg-1', 'theme-bg-2');

            // 根据当前主题设置默认颜色
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            const isDark = currentTheme === 'dark' || (!currentTheme && isSystemDark);
            const defaultColor = isDark ? '100, 155, 210' : '85, 125, 165';
            document.documentElement.style.setProperty('--theme-color-rgb-current', defaultColor);

            currentDisplayColor = null;

            document.documentElement.style.removeProperty('--accent');
            document.documentElement.style.removeProperty('--accent-light');
            document.documentElement.style.removeProperty('--accent-medium');
            document.documentElement.style.removeProperty('--accent-hover');
        }
    }

    // 提取图片的主题色
    function getAverageColor(imgElement) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = imgElement.width || imgElement.naturalWidth || 64;
        canvas.height = imgElement.height || imgElement.naturalHeight || 64;

        if (canvas.width === 0 || canvas.height === 0) return null;

        ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);
        try {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            let r = 0, g = 0, b = 0, count = 0;

            for (let i = 0; i < data.length; i += 16) {
                if (data[i + 3] > 128) { // 忽略透明度高的像素
                    r += data[i];
                    g += data[i + 1];
                    b += data[i + 2];
                    count++;
                }
            }
            if (count > 0) {
                r = Math.floor(r / count);
                g = Math.floor(g / count);
                b = Math.floor(b / count);
                return `${r}, ${g}, ${b}`;
            }
        } catch (e) {
            console.error(e);
        }
        return null;
    }

    // 初始化主题
    function initTheme() {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            document.documentElement.setAttribute('data-theme', savedTheme);
        }
    }

    // 切换主题
    function toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        let newTheme;

        if (currentTheme) {
            newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        } else {
            // 如果没有手动设置过，则根据系统偏好取反
            const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            newTheme = isSystemDark ? 'light' : 'dark';
        }

        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeBackground();
    }

    // 创建新的 GainNode，并释放上一个。
    // play() 中有 gainNode.connect(analyserNode)，若不显式断开，
    // 旧的 GainNode 会一直挂在 analyserNode → destination 上，
    // 每切一次歌就多一个常驻节点，长时间播放会不断累积。
    function createGainNode() {
        if (gainNode) {
            try {
                gainNode.disconnect();
            } catch (e) {
                // 已断开或节点已失效，忽略
            }
            gainNode = null;
        }
        gainNode = audioContext.createGain();
        return gainNode;
    }

    let play = function () {
        // 取消可能仍在运行的淡出，避免它在新一轮播放期间把音量拉回 0
        cancelFadeOut();
        // 恢复播放：淡出窗口结束，视听回到播放态
        isFadingOut = false;
        pitchShifter.connect(gainNode);
        gainNode.connect(analyserNode);
        analyserNode.connect(audioContext.destination);
        audioContext.resume().then(() => {
            isPlaying = true;
            setPlayPauseButtonState(true);
            if (!visualizerAnimationFrame) {
                drawVisualizer();
            }
            if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = 'playing';
            }
        });
    };

    // 切换播放按钮的图标与提示文案。
    // 按钮上的 data-i18n-title 原本写死为 "play"，而 updatePageTexts() 会按该属性
    // 重写 title，导致播放中仍提示"播放"。这里同步切换 i18n key 再刷新文案。
    function setPlayPauseButtonState(playing) {
        playPauseBtn.innerHTML = playing
            ? '<i class="fa-solid fa-pause"></i>'
            : '<i class="fa-solid fa-play"></i>';
        playPauseBtn.setAttribute('data-i18n-title', playing ? 'pause' : 'play');
        i18n.updatePageTexts();
    }

    // 停止频谱动画：取消 rAF 续帧并清空画布，避免暂停后 GPU 持续空转
    function stopVisualizer() {
        // 这里是"停止表现"的唯一收口点，同时清掉淡出标记，
        // 避免其它停止路径（删除歌曲、解码失败等）留下标志导致 drawVisualizer 继续续帧
        isFadingOut = false;
        if (visualizerAnimationFrame) {
            cancelAnimationFrame(visualizerAnimationFrame);
            visualizerAnimationFrame = null;
        }
        if (visualizerCanvas && visualizerCtx) {
            visualizerCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
        }
    }

    function drawVisualizer() {
        if (!visualizerCanvas || !visualizerCtx) return;
        // 未在播放时不再续帧，作为兜底防止 rAF 循环泄漏。
        // 淡出期间声音仍然可闻，频谱要继续画到真正静音为止。
        if (!isPlaying && !isFadingOut) {
            visualizerAnimationFrame = null;
            return;
        }
        visualizerAnimationFrame = requestAnimationFrame(drawVisualizer);

        const width = visualizerCanvas.clientWidth;
        const height = visualizerCanvas.clientHeight;
        if (visualizerCanvas.width !== width || visualizerCanvas.height !== height) {
            visualizerCanvas.width = width;
            visualizerCanvas.height = height;
        }

        const bufferLength = analyserNode.frequencyBinCount;
        // 复用缓冲区，避免每帧分配造成 GC 压力
        if (!visualizerDataArray || visualizerDataArray.length !== bufferLength) {
            visualizerDataArray = new Uint8Array(bufferLength);
        }
        const dataArray = visualizerDataArray;
        analyserNode.getByteFrequencyData(dataArray);

        visualizerCtx.clearRect(0, 0, width, height);

        const currentTheme = document.documentElement.getAttribute('data-theme');
        const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const isDark = currentTheme === 'dark' || (!currentTheme && isSystemDark);

        // 使用专辑封面色或融入背景的颜色 (配合透明度使用)
        const baseColor = currentDisplayColor ? currentDisplayColor : (isDark ? '255, 255, 255' : '100, 116, 139');

        // 末点落在 x = width，避免右侧收尾线斜切进画布内部
        const sliceWidth = width / Math.max(1, bufferLength - 1);
        let points = [];

        // 收集平滑曲线的点，减少高度拉伸
        for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 255.0;
            const y = height - (v * height * 0.65);
            points.push({x: i * sliceWidth, y: y});
        }

        visualizerCtx.beginPath();
        visualizerCtx.moveTo(0, height);

        if (points.length > 0) {
            visualizerCtx.lineTo(0, points[0].y);

            for (let i = 0; i < points.length - 1; i++) {
                const xc = (points[i].x + points[i + 1].x) / 2;
                const yc = (points[i].y + points[i + 1].y) / 2;
                visualizerCtx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
            }

            const lastP = points[points.length - 1];
            visualizerCtx.lineTo(lastP.x, lastP.y);
            visualizerCtx.lineTo(width, height);
        }
        visualizerCtx.closePath();

        // 填充背景渐变
        const gradient = visualizerCtx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, `rgba(${baseColor}, 0.15)`);
        gradient.addColorStop(1, `rgba(${baseColor}, 0.0)`);

        visualizerCtx.fillStyle = gradient;
        visualizerCtx.fill();

        // 绘制顶部流畅曲线
        visualizerCtx.strokeStyle = `rgba(${baseColor}, 0.3)`;
        visualizerCtx.lineWidth = 1.5;
        visualizerCtx.stroke();
    }

// 初始化音频播放器
    function setupAudioPlayer() {
        if (togglePlaylistBtn && sidebarLayout) {
            togglePlaylistBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                sidebarLayout.classList.toggle('show-mobile');
            });
            // 也可以点击主区域关闭侧边栏
            document.getElementById('main-layout').addEventListener('click', (e) => {
                if (window.innerWidth <= 800 && sidebarLayout.classList.contains('show-mobile')) {
                    sidebarLayout.classList.remove('show-mobile');
                }
            });
        }

        folderInput.addEventListener('change', handleFolderInputChange);
        singleInput.addEventListener('change', function () {
            const files = singleInput.files;
            processDroppedFiles(files);
            // 重置 input 值，确保下次选择相同文件时能触发 change 事件
            singleInput.value = '';
        });

        // 判断当前拖拽是否携带外部文件（列表内排序只带 text/plain，不应触发导入高亮）
        function isFileDrag(e) {
            const types = e.dataTransfer && e.dataTransfer.types;
            if (!types) return false;
            return Array.prototype.indexOf.call(types, 'Files') !== -1;
        }

        // 拖拽事件绑定到 document，确保从外部拖入文件时能正确触发
        document.addEventListener('dragover', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (isFileDrag(e)) {
                dragDropZone.classList.add('dragover');
            } else {
                dragDropZone.classList.remove('dragover');
            }
        });

        document.addEventListener('dragleave', function (e) {
            e.preventDefault();
            e.stopPropagation();
            // 只有当鼠标真正离开窗口时才移除 dragover 样式
            if (e.relatedTarget === null || e.relatedTarget === document.documentElement) {
                dragDropZone.classList.remove('dragover');
            }
        });

        document.addEventListener('drop', function (e) {
            e.preventDefault();
            e.stopPropagation();
            dragDropZone.classList.remove('dragover');

            const files = e.dataTransfer.files;
            if (files.length === 0) return;

            processDroppedFiles(files);
        });

        playPauseBtn.addEventListener('click', handlePlayPause);
        prevBtn.addEventListener('click', handlePrevSong);
        nextBtn.addEventListener('click', handleNextSong);
        randomBtn.addEventListener('click', handleRandomToggle);
        loopBtn.addEventListener('click', handleLoopToggle);
        pitchShiftSelect.addEventListener('input', handlePitchShiftChange);
        tempoShiftSelect.addEventListener('input', function () {
            currentTempoShift = parseFloat(tempoShiftSelect.value);
            if (tempoShiftVal) {
                tempoShiftVal.textContent = currentTempoShift.toFixed(1) + 'x';
            }
            if (pitchShifter) {
                pitchShifter.tempo = currentTempoShift;
            }
        });
        progress.addEventListener('click', function (event) {
            if (!pitchShifter) return;
            const rect = progress.getBoundingClientRect();
            const clickX = event.clientX - rect.left;
            const progressWidth = rect.width;
            seekToTime((clickX / progressWidth) * pitchShifter.duration, true);
        });
        searchInput.addEventListener('input', handleSearchInput);

        // 浏览器在前进/后退时会恢复表单控件的旧值（搜索框文本、滑轨档位），
        // 但页面 JS 状态是全新的，导致显示与实际状态不一致。这里在页面重新显示时统一复位。
        window.addEventListener('pageshow', function (e) {
            // persisted 为 true 表示来自 bfcache 缓存，页面状态本身是完好的，无需复位
            if (e.persisted) return;

            searchInput.value = '';
            searchInput.classList.remove('error');
            pitchShiftSelect.value = '0';
            tempoShiftSelect.value = '1';
            handlePitchShiftChange();
            if (tempoShiftVal) {
                tempoShiftVal.textContent = '1.0x';
            }
        });

        if (deleteSelectedBtn) {
            deleteSelectedBtn.addEventListener('click', () => {
                if (selectedSongs.size > 0) {
                    const playingSong = songs[currentSongIndex];
                    let removedPlaying = false;
                    let playingSongOriginalIndex = currentSongIndex;

                    // 通过 DOM 元素的顺序索引来删除，避免 selectedSongs 对象引用失效的问题
                    // 遍历所有可见的 song-item，如果被选中则记录其索引
                    const allItems = Array.from(songList.querySelectorAll('.song-item'));
                    const indicesToRemove = [];
                    allItems.forEach((item, index) => {
                        if (item.classList.contains('selected')) {
                            if (index === currentSongIndex) {
                                removedPlaying = true;
                            }
                            indicesToRemove.push(index);
                        }
                    });

                    // 从大到小排序，确保删除时索引不会偏移
                    indicesToRemove.sort((a, b) => b - a);

                    // 执行删除
                    indicesToRemove.forEach(indexToRemove => {
                        songs.splice(indexToRemove, 1);
                    });

                    // 重新渲染列表
                    renderSongList();

                    selectedSongs.clear();
                    lastSelectedSong = null;
                    updatePlaylistActions();

                    if (songs.length === 0) {
                        currentSongIndex = 0;
                        currentSong = null;
                        // 停止播放并重置所有状态（含停止 pitchShifter）
                        resetToEmptyPlaylistState();
                    } else {
                        if (removedPlaying) {
                            // 播放被删除歌曲的下一首
                            // 如果被删除的是最后一首，则播放新的最后一首
                            currentSongIndex = Math.min(playingSongOriginalIndex, songs.length - 1);
                            currentSeek = 0;
                            playSong(songs[currentSongIndex]);
                        } else {
                            // 重新查找正在播放的歌曲在新列表中的位置
                            currentSongIndex = songs.indexOf(playingSong);
                            if (currentSongIndex === -1) {
                                currentSongIndex = 0;
                                // 原当前歌曲已被删除，同步引用避免指向不存在的歌曲
                                currentSong = songs[0] || null;
                            }
                        }
                    }

                    // 更新 active 类
                    const songItems = songList.querySelectorAll('.song-item');
                    songItems.forEach((item, index) => {
                        item.classList.toggle('active', index === currentSongIndex);
                    });
                }
            });
        }

        if ('mediaSession' in navigator) {
            setMediaActionHandler('play', () => {
                if (!isPlaying) resumeSong();
            });
            setMediaActionHandler('pause', () => {
                if (isPlaying) pauseSong();
            });
            setMediaActionHandler('previoustrack', handlePrevSong);
            setMediaActionHandler('nexttrack', handleNextSong);
            setMediaActionHandler('seekto', details => {
                if (details.seekTime != null) seekToTime(details.seekTime, true);
            });
            setMediaActionHandler('seekbackward', details => {
                seekToTime(currentSeek - ((details && details.seekOffset) || 10), true);
            });
            setMediaActionHandler('seekforward', details => {
                seekToTime(currentSeek + ((details && details.seekOffset) || 10), true);
            });
        }

        if (multiSelectBtn) {
            multiSelectBtn.addEventListener('click', () => {
                multiSelectMode = !multiSelectMode;
                multiSelectBtn.classList.toggle('active', multiSelectMode);
                songList.classList.toggle('multi-select-mode', multiSelectMode);
                if (multiSelectMode) {
                    if (selectAllBtn) selectAllBtn.classList.remove('hidden');
                    updatePlaylistActions();
                } else {
                    if (selectAllBtn) selectAllBtn.classList.add('hidden');
                    selectedSongs.clear();
                    lastSelectedSong = null;
                    const allItems = songList.querySelectorAll('.song-item');
                    allItems.forEach(i => i.classList.remove('selected'));
                    updatePlaylistActions();
                }
            });
        }

        if (selectAllBtn) {
            selectAllBtn.addEventListener('click', () => {
                const allItems = Array.from(songList.querySelectorAll('.song-item'));
                const songItems = allItems.filter(i => i.style.display !== 'none');
                const allSelected = songItems.length > 0 && songItems.every(i => i.classList.contains('selected'));

                if (allSelected) {
                    // 取消全选必须清掉所有行的 selected，包括被搜索过滤隐藏的行。
                    // 删除是按 DOM 的 .selected 类扫描全部行的，若只摘可见行，
                    // 隐藏行会残留不可见的选中态，之后删除时把它们一并删掉。
                    allItems.forEach(item => {
                        item.classList.remove('selected');
                    });
                    selectedSongs.clear();
                } else {
                    songItems.forEach(item => {
                        item.classList.add('selected');
                    });
                    // 全选时直接将所有可见歌曲加入 selectedSongs
                    // 使用 songs 数组的索引来确保引用正确
                    selectedSongs.clear();
                    songItems.forEach(item => {
                        const idx = allItems.indexOf(item);
                        if (idx > -1 && idx < songs.length) {
                            selectedSongs.add(songs[idx]);
                        }
                    });
                }
                updatePlaylistActions();
            });
        }
    }

// ====================== 文件处理通用函数 ======================
    function processDroppedFiles(files) {
        let newSongs = [];
        // 用对象引用而非 isPlaying ? songs[currentSongIndex] 捕获当前歌曲：
        // 暂停时 isPlaying 为 false，但当前歌曲依然存在，下标也会因重排而失效。
        const previousSong = currentSong;
        const wasEmpty = songs.length === 0;
        // 已存在的歌曲会被移动到顶部，这会改变 songs 顺序，
        // 因此即使没有新歌也必须重渲染，否则数组与 DOM 顺序会永久错位。
        let reordered = false;

        // 首先遍历所有文件，保存图片文件到 allFiles 映射中
        Array.from(files).forEach(file => {
            const filePath = file.webkitRelativePath || file.name;
            const fileName = file.name.toLowerCase();

            // 检查是否是封面图片文件
            if (fileName === 'cover.jpg' || fileName === 'cover.jpeg' ||
                fileName === 'cover.png' || fileName === 'cover.webp' ||
                fileName === 'folder.jpg' || fileName === 'folder.png') {
                // 保存图片文件，用于后续查找封面
                allFilesMap.set(filePath, file);
            }
        });

        // 检查是否有音频文件，如果已存在则置顶
        Array.from(files).forEach(file => {
            if (file.type.startsWith('audio/')) {
                // 获取文件路径：优先使用 webkitRelativePath（包含文件夹路径），否则使用文件名
                const filePath = file.webkitRelativePath || file.name;

                // 去重键：使用 "文件名|文件大小" 组合作为唯一标识
                // 原因：
                // 1. 文件夹选择时 webkitRelativePath 为 "folder/song.mp3"，拖拽/单文件选择时只有 "song.mp3"
                // 2. 不同子文件夹可能有同名文件，但同名同大小的概率极低
                // 3. 同文件不同方式添加时，文件名和大小一定相同
                const dedupeKey = `${file.name}|${file.size}`;

                // 检查歌曲列表中是否已有相同文件
                const existingIndex = songs.findIndex(s => `${s.name}|${s.size}` === dedupeKey);

                if (existingIndex > -1) {
                    // 已存在：移动到顶部
                    const existingSong = songs[existingIndex];
                    songs.splice(existingIndex, 1);
                    songs.unshift(existingSong);
                    reordered = true;
                } else {
                    // 不存在：添加新歌曲，同时存储路径用于去重
                    newSongs.push({name: file.name, path: filePath, file: file, size: file.size});
                }
            }
        });

        // 如果有新歌曲，添加到数组顶部
        if (newSongs.length > 0) {
            songs.unshift(...newSongs);
        }

        // 如果有任何变化（新歌曲或顺序被调整）
        if (newSongs.length > 0 || reordered) {
            // 清除选中状态，避免旧的 selectedSongs 引用导致问题
            selectedSongs.clear();
            lastSelectedSong = null;
            // 如果处于多选模式，退出多选模式
            if (multiSelectMode) {
                multiSelectMode = false;
                multiSelectBtn.classList.remove('active');
                songList.classList.remove('multi-select-mode');
                if (selectAllBtn) selectAllBtn.classList.add('hidden');
                if (deleteSelectedBtn) deleteSelectedBtn.classList.add('hidden');
            }
            updatePlaylistActions();

            // 重新渲染列表
            renderSongList();

            // 更新当前播放索引：通过对象引用重新定位，而不是沿用旧下标
            if (previousSong) {
                const newIndex = songs.indexOf(previousSong);
                if (newIndex === -1) {
                    // 原当前歌曲已不在列表中，索引与引用一起收敛到首项，
                    // 否则 currentSong 会一直指向已被移除的歌曲
                    currentSongIndex = 0;
                    currentSong = songs[0] || null;
                } else {
                    currentSongIndex = newIndex;
                }
            } else if (wasEmpty && songs.length > 0) {
                // 列表之前为空，添加新歌曲后自动播放第一首
                currentSongIndex = 0;
                playSong(songs[currentSongIndex]);
            } else if (currentSongIndex >= songs.length) {
                // 当前歌曲已不在列表中，收敛到有效范围
                currentSongIndex = Math.max(0, songs.length - 1);
                currentSong = songs[currentSongIndex] || null;
            }

            // Re-bind active classes
            const songItems = songList.querySelectorAll('.song-item');
            songItems.forEach((item, index) => {
                item.classList.toggle('active', index === currentSongIndex);
            });

            // 滚动到正在播放的歌曲
            scrollToActiveSong();
        }
    }

// 处理文件夹输入变化
    function handleFolderInputChange(event) {
        const files = event.target.files;
        processDroppedFiles(files);
        // 重置 input 值，确保下次选择相同文件夹时能触发 change 事件
        event.target.value = '';
    }

// 创建歌曲��表项
    function createSongListItem(song) {
        const listItem = document.createElement('div');
        listItem.classList.add('song-item');
        listItem.draggable = true;
        // song.name 来自本地文件名或外部接口，属于不可信输入，
        // 必须走 textContent/title 属性赋值，不能拼进 innerHTML
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-music';
        const title = document.createElement('span');
        title.className = 'song-item-title';
        title.textContent = song.name;
        title.title = song.name;
        listItem.appendChild(icon);
        listItem.appendChild(title);

        listItem.addEventListener('click', (e) => {
            const index = songs.indexOf(song);
            // Shift 用于范围选择，必须先于 ctrl/meta 判断，
            // 否则会被下面的单选切换分支吃掉，永远走不到范围逻辑。
            // 只在多选模式下生效：删除按钮与 Delete 快捷键都要求 multiSelectMode，
            // 非多选模式下的框选结果无法执行，留着反而会让用户以为能删。
            if (e.shiftKey && lastSelectedSong && multiSelectMode) {
                const lastIndex = songs.indexOf(lastSelectedSong);
                if (lastIndex > -1) {
                    const start = Math.min(lastIndex, index);
                    const end = Math.max(lastIndex, index);
                    selectedSongs.clear();
                    const allItems = songList.querySelectorAll('.song-item');
                    allItems.forEach(i => i.classList.remove('selected'));
                    for (let i = start; i <= end; i++) {
                        // 跳过被搜索过滤隐藏的行：删除是按 .selected 扫描全部行的，
                        // 选中看不见的歌会让用户以为只删了可见的那些
                        if (songs[i] && (!allItems[i] || allItems[i].style.display !== 'none')) {
                            selectedSongs.add(songs[i]);
                            if (allItems[i]) allItems[i].classList.add('selected');
                        }
                    }
                    // 锚点保持不变，连续 Shift 扩展才有意义
                    updatePlaylistActions();
                    return;
                }
            }

            if (multiSelectMode || e.ctrlKey || e.metaKey || e.shiftKey) {
                if (selectedSongs.has(song)) {
                    selectedSongs.delete(song);
                    listItem.classList.remove('selected');
                } else {
                    selectedSongs.add(song);
                    listItem.classList.add('selected');
                }
                lastSelectedSong = song;
            } else {
                selectedSongs.clear();
                const allItems = songList.querySelectorAll('.song-item');
                allItems.forEach(i => i.classList.remove('selected'));
                lastSelectedSong = song;

                currentSongIndex = index;
                currentSeek = 0;
                playSong(song);
            }
            updatePlaylistActions();
        });

        // Drag and drop sorting
        listItem.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', songs.indexOf(song));
            listItem.classList.add('dragging');
        });

        listItem.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            listItem.classList.add('drag-over');
        });

        listItem.addEventListener('dragleave', () => {
            listItem.classList.remove('drag-over');
        });

        listItem.addEventListener('drop', (e) => {
            e.stopPropagation();
            listItem.classList.remove('drag-over');
            const draggedIndex = parseInt(e.dataTransfer.getData('text/plain'));
            const targetIndex = songs.indexOf(song);

            if (draggedIndex !== targetIndex && !isNaN(draggedIndex)) {
                // Determine current playing song
                // 优先用对象引用，currentSongIndex 可能在拖拽前已因重排而失效
                const playingSong = currentSong || songs[currentSongIndex];

                // Reorder array
                const [draggedSong] = songs.splice(draggedIndex, 1);
                songs.splice(targetIndex, 0, draggedSong);

                // Reorder DOM
                const allItems = Array.from(songList.children);
                if (draggedIndex < targetIndex) {
                    songList.insertBefore(allItems[draggedIndex], listItem.nextSibling);
                } else {
                    songList.insertBefore(allItems[draggedIndex], listItem);
                }

                // Update currentSongIndex so playback isn't interrupted
                const relocatedIndex = songs.indexOf(playingSong);
                if (relocatedIndex !== -1) {
                    currentSongIndex = relocatedIndex;
                    currentSong = playingSong;
                }
            }
        });

        listItem.addEventListener('dragend', () => {
            listItem.classList.remove('dragging');
        });

        return listItem;
    }

    function updatePlaylistActions() {
        if (multiSelectMode) {
            if (deleteSelectedBtn) {
                if (selectedSongs.size > 0) {
                    deleteSelectedBtn.style.opacity = '1';
                    deleteSelectedBtn.style.pointerEvents = 'auto';
                } else {
                    deleteSelectedBtn.style.opacity = '0.5';
                    deleteSelectedBtn.style.pointerEvents = 'none';
                }
                deleteSelectedBtn.classList.remove('hidden');
            }
        } else {
            if (deleteSelectedBtn) deleteSelectedBtn.classList.add('hidden');
        }
    }

// 处理播放暂停按钮点击
    function handlePlayPause() {
        if (isPlaying) {
            pauseSong();
        } else {
            resumeSong();
        }
    }

// 处理上一首按钮点击
    function handlePrevSong() {
        // 空列表时 % 0 会得到 NaN，之后所有索引比较静默失效
        if (songs.length === 0) return;
        disconnectPitchShifter();
        currentSongIndex = (currentSongIndex - 1 + songs.length) % songs.length;
        currentSeek = 0;
        playSong(songs[currentSongIndex]);
    }

// 处理下一首按钮点击
    function handleNextSong() {
        if (songs.length === 0) return;
        disconnectPitchShifter();
        if (isRandom) {
            currentSongIndex = Math.floor(Math.random() * songs.length);
        } else {
            currentSongIndex = (currentSongIndex + 1) % songs.length;
        }
        currentSeek = 0;
        playSong(songs[currentSongIndex]);
    }

// 处理随机播放开关
    function handleRandomToggle() {
        isRandom = !isRandom;
        randomBtn.classList.toggle('active', isRandom);
    }

// 处理循环播放开关
    function handleLoopToggle() {
        isLooping = !isLooping;
        loopBtn.classList.toggle('active', isLooping);
    }

// 处理音高偏移变化
    function handlePitchShiftChange() {
        currentPitchShift = parseInt(pitchShiftSelect.value);
        if (pitchShiftVal) {
            pitchShiftVal.textContent = currentPitchShift > 0 ? '+' + currentPitchShift : currentPitchShift;
        }
        if (pitchShifter) {
            pitchShifter.pitch = Math.pow(2.0, currentPitchShift / 12.0);
        }
    }

// 处理搜索输入
    function handleSearchInput() {
        applySearchFilter();
        // 搜索内容变化时（包括清空），滚动到当前播放歌曲
        scrollToActiveSong();
    }

    // 按搜索框内容过滤列表行。不含滚动，便于在重建列表时复用。
    function applySearchFilter() {
        const searchTerm = searchInput.value.trim().toLowerCase();
        const songItems = songList.querySelectorAll('.song-item');
        let hasMatch = false;

        songItems.forEach((item) => {
            const songName = item.textContent.toLowerCase();
            if (searchTerm === '' || songName.includes(searchTerm)) {
                item.style.display = '';
                hasMatch = true;
            } else {
                item.style.display = 'none';
            }
        });

        if (!hasMatch && searchTerm !== '') {
            searchInput.classList.add('error');
            songItems.forEach((item) => {
                item.style.display = '';
            });
        } else {
            searchInput.classList.remove('error');
        }
    }

    // 重建播放列表。
    // 搜索过滤的结果只体现在各行的 style.display 上，重新创建的行不会自带该状态。
    // 因此重建后必须重放过滤，否则搜索框仍显示关键词而列表却恢复全部可见，
    // 此时"全选 + 删除"会把被过滤隐藏的歌曲一并删除。
    // 这里只应用过滤、不滚动：各调用方会在更新完 currentSongIndex 之后自行滚动。
    function renderSongList() {
        songList.innerHTML = '';
        songs.forEach(song => {
            const listItem = createSongListItem(song);
            songList.appendChild(listItem);
        });

        applySearchFilter();
    }

// 播放歌曲
    function playSong(song) {
        if (!song) return;

        // 记录当前歌曲引用，供列表重排/重渲染后重新定位
        currentSong = song;

        // 小屏幕时点击播放后自动关闭播放列表
        closeMobilePlaylistIfOpen();

        // 非本地文件来源的歌曲：交给已注册的歌曲源处理器
        if (songSourceHandler && typeof songSourceHandler.canHandle === 'function'
            && songSourceHandler.canHandle(song)) {
            // 处理器需要完整的外部元数据才能取流；缺了就走复位路径，
            // 否则它会直接返回，把播放器留在 isPlaying=true 且 pitchShifter=null
            // 的死状态（正是 playbackFailed 注释里说要避免的那种）
            if (!song.onlineInfo || !song.onlineInfo.id) {
                console.error('Song is missing onlineInfo:', song.name);
                handleDecodeError(song, new Error('missing onlineInfo'));
                return;
            }
            // 先接管加载令牌：处理器可能提前返回（如引擎未就绪），
            // 若不失效旧请求，上一首的 pitchShifter 会继续发声，
            // 而界面已经切到新歌，形成"标题是A、声音是B、暂停停错歌"。
            // 处理器内部通常还会再调一次 beginPlayback，那是幂等的。
            beginPlayback();
            songSourceHandler.play(song);
            return;
        }

        // 没有音频源的条目不能落入本地文件路径：
        // FileReader.readAsArrayBuffer(undefined) 会抛 TypeError，
        // 被 catch 成 handleFileError → songs.splice，把条目从列表里删掉。
        // 这类歌曲本身不带 File 对象，缺失属正常情况，不该当成"文件被删除"。
        if (!song.file) {
            console.error('No audio source for song:', song.name);
            handleDecodeError(song, new Error('no audio source'));
            return;
        }

        // 切到本地歌曲时通知处理器熄灭"正在播放"高亮。
        // 它只在自己的 play() 里点亮结果行，主播放器切到本地文件时
        // 没有回调能告诉它，那一行会一直亮着。
        if (songSourceHandler && typeof songSourceHandler.onLocalSongPlayed === 'function') {
            try { songSourceHandler.onLocalSongPlayed(); } catch (e) { /* 处理器异常不影响播放 */ }
        }

        // 本地歌曲：从文件读取
        // 与外部来源共用 beginPlayback：它会 ++loadRequestId、停掉旧移调器、
        // 取消在跑的淡入淡出、重建增益节点。两处各写一份必然会走漏——
        // 之前本地路径就漏了取消淡出，淡出期间切歌会把新歌误停。
        const currentRequestId = beginPlayback();

        const reader = new FileReader();
        reader.onload = (e) => {
            if (currentRequestId !== loadRequestId) return;
            audioContext.decodeAudioData(e.target.result, function (audioBuffer) {
                if (currentRequestId !== loadRequestId) return;
                const bufferSize = 16384;
                const ps = new PitchShifter(audioContext, audioBuffer, bufferSize);
                pitchShifter = ps;
                ps.pitch = Math.pow(2.0, currentPitchShift / 12.0);
                ps.tempo = currentTempoShift;
                ps.on('play', (detail) => {
                    currentSeek = parseFloat(detail.timePlayed);
                    updateProgress(currentSeek, ps.duration);
                    // 必须比较数值：formattedTimePlayed 是 "M:SS" 字符串，
                    // 与 "MM:SS" 做字典序比较会因 ':' > 数字而在 1~9 分钟处误判为播完
                    if (detail.timePlayed >= ps.duration) {
                        if (isLooping) {
                            ps.percentagePlayed = 0;
                            currentSeek = 0;
                        } else {
                            handleNextSong();
                        }
                    }
                });

                play()

                updateTitle(song.name);

                // 本地歌曲：从文件读取封面
                updatePageIcon(song.file, song.name);

                scrollToActiveSong();

                const songItems = songList.querySelectorAll('.song-item');
                songItems.forEach((item, index) => {
                    item.classList.toggle('active', index === currentSongIndex);
                });

            }, function (error) {
                console.log("Filereader error: " + error.err);
                // 解码失败时 pitchShifter 已被置空，但 isPlaying 仍为 true，
                // 导致 pauseSong 被 if (pitchShifter) 挡住、播放键与可视化一直卡在播放态。
                // 这里把状态复位，让用户仍可选择其它歌曲。
                if (currentRequestId !== loadRequestId) return;
                handleDecodeError(song, error);
            });
        };

        reader.onerror = () => {
            console.error("File read error: File may have been deleted.", song.name);
            handleFileError(song);
        };

        try {
            reader.readAsArrayBuffer(song.file);
        } catch (e) {
            console.error("Error reading file:", e);
            handleFileError(song);
        }
    }

    // 处理解码失败（文件损坏或编码不支持）。
    // 与 handleFileError 不同，这里不移除歌曲——文件本身可能没问题，
    // 只是本次解码失败，保留条目让用户可以重试或改用其它解码器。
    // 关键是必须把播放器状态复位，否则会卡在无法控制的"播放中"。
    function handleDecodeError(song, error) {
        console.error("Audio decode failed:", song && song.name, error);

        // 只有当失败的仍是当前歌曲时才复位，避免覆盖掉用户已切到的新歌
        if (currentSong !== song) return;

        // 必须真正停掉节点再置空：只断开引用的话，ScriptProcessorNode 仍挂在
        // gainNode → analyserNode → destination 上继续发声，
        // 表现为"界面显示已停止、进度条归零，但声音还在放"的幽灵状态。
        if (pitchShifter) {
            try {
                if (typeof pitchShifter.stop === 'function') {
                    pitchShifter.stop();
                } else {
                    pitchShifter.disconnect();
                }
            } catch (e) {
                console.error("Error stopping pitchShifter:", e);
            }
            pitchShifter = null;
        }
        isPlaying = false;
        isFadingOut = false;
        currentSeek = 0;
        // 与 resetToEmptyPlaylistState 保持一致：淡入/淡出计时器若仍在跑，
        // 会继续往已解绑的增益节点写音量
        cancelFadeIn();
        cancelFadeOut();
        stopVisualizer();
        setPlayPauseButtonState(false);
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'paused';
        }
        progressBar.style.width = '0%';

        // 元数据也要复位：updateTitle / updatePageIcon 只在解码成功后才执行，
        // 不清的话标题、封面、主题色、favicon 仍是上一首歌的，
        // 与列表里高亮的失败歌曲对不上。
        // 作废在途封面请求，避免它们随后又把旧封面写回来。
        coverRequestId++;
        const failedName = song && song.name ? song.name : '';
        const titleText = playerTitle.querySelector('.sidebar-title-text');
        if (titleText) {
            titleText.textContent = failedName.replace(/\.[^/.]+$/, '') || 'Music Player';
            titleText.style.setProperty('--marquee-distance', '0px');
        }
        playerTitle.classList.remove('overflow');
        document.title = failedName.replace(/\.[^/.]+$/, '') || 'Music Player';
        currentAlbumColor = null;
        updateThemeBackground();
        resetIcons();
        const albumCoverImg = document.getElementById('album-cover');
        if (albumCoverImg) {
            albumCoverImg.src = '';
            albumCoverImg.style.display = 'none';
        }
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: document.title,
                artist: 'Unknown Artist',
                album: 'Unknown Album'
            });
        }
    }

    // 播放列表清空后的统一复位（删除按钮、文件失效、Delete 键三处共用）。
    // 关键是必须作废在途的封面加载：封面链路是异步的（FileReader / Image.onload），
    // 若不推进 coverRequestId，已删除歌曲的封面会在复位之后重新写回主题色、
    // favicon 与 Electron 任务栏图标。
    function resetToEmptyPlaylistState() {
        // 作废所有在途封面请求
        coverRequestId++;

        if (pitchShifter) {
            try {
                if (typeof pitchShifter.stop === 'function') {
                    pitchShifter.stop();
                } else {
                    pitchShifter.disconnect();
                }
            } catch (e) {
                console.error("Error stopping pitchShifter:", e);
            }
            pitchShifter = null;
        }

        isPlaying = false;
        isFadingOut = false;
        cancelFadeIn();
        cancelFadeOut();
        stopVisualizer();
        setPlayPauseButtonState(false);
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'paused';
        }
        progressBar.style.width = '0%';
        // 恢复默认配色与图标
        currentAlbumColor = null;
        updateThemeBackground();
        resetIcons();
        // 恢复默认标题
        const titleText = playerTitle.querySelector('.sidebar-title-text');
        if (titleText) {
            titleText.textContent = 'Music Player';
            titleText.style.setProperty('--marquee-distance', '0px');
        } else {
            playerTitle.textContent = 'Music Player';
        }
        playerTitle.classList.remove('overflow');
        playerTitle.title = 'Music Player';
        document.title = 'Music Player';
        // 隐藏专辑封面
        const albumCoverImg = document.getElementById('album-cover');
        if (albumCoverImg) {
            albumCoverImg.src = '';
            albumCoverImg.style.display = 'none';
        }
    }

    // 新增：处理文件失效的逻辑
    function handleFileError(song) {
        const indexToRemove = songs.indexOf(song);
        if (indexToRemove === -1) return;

        // 从列表中移除
        songs.splice(indexToRemove, 1);

        // 移除 DOM 元素
        const songItems = songList.querySelectorAll('.song-item');
        if (songItems[indexToRemove]) {
            songList.removeChild(songItems[indexToRemove]);
        }

        // 如果列表为空
        if (songs.length === 0) {
            currentSongIndex = 0;
            currentSong = null;
            resetToEmptyPlaylistState();
            return;
        }

        // 如果删除的是当前正在播放（或即将播放）的歌曲
        // 用对象引用比较，避免下标在重排后失效导致删错歌
        if (song === currentSong || indexToRemove === currentSongIndex) {
            // 如果删除的是最后一首，则播放新的最后一首
            if (currentSongIndex >= songs.length) {
                currentSongIndex = songs.length - 1;
            }
            // 播放下一首（或新的最后一首）
            playSong(songs[currentSongIndex]);
        } else if (indexToRemove < currentSongIndex) {
            // 如果删除的歌曲在当前播放歌曲之前，需要调整索引
            currentSongIndex--;
        }
        // 如果删除的歌曲在当前播放歌曲之后，不需要调整索引，仅删除即可
        // （currentSong 引用本就无需变动：删的是后面的歌，不是当前这首）

        // 更新 active 类
        const updatedSongItems = songList.querySelectorAll('.song-item');
        updatedSongItems.forEach((item, index) => {
            item.classList.toggle('active', index === currentSongIndex);
        });
    }

// 暂停歌曲
    function pauseSong() {
        if (!pitchShifter) return;

        // isPlaying 立即翻转：淡出是异步的，若等回调才置位，
        // 这一秒内再次点击播放键会被当成"再暂停一次"而无法恢复。
        //
        // 但视听表现（频谱动画、按钮图标）必须等到淡出真正结束再停，
        // 否则声音还在响、可视化却已冻结，出现视听错位。
        // isFadingOut 标记这段窗口，drawVisualizer 据此继续续帧。
        const shifterAtPause = pitchShifter;
        isPlaying = false;
        isFadingOut = true;

        fadeOut(gainNode, () => {
            isFadingOut = false;
            // 淡出期间用户可能已切到下一首，此时模块级 pitchShifter 指向新的一首，
            // 无条件断开会把它误杀，表现为新歌响半秒就没声。
            if (pitchShifter === shifterAtPause) {
                disconnectPitchShifter();
            }
            // 只有确实停在当前这首时才落到暂停表现；
            // 若期间已恢复播放或切歌，由那条路径自己接管。
            if (pitchShifter === shifterAtPause) {
                stopVisualizer();
                setPlayPauseButtonState(false);
                if ('mediaSession' in navigator) {
                    navigator.mediaSession.playbackState = 'paused';
                }
            }
        });
    }

// 播放歌曲
    function resumeSong() {
        if (pitchShifter) {
            play();
            fadeIn(gainNode)
        } else {
            playSong(songs[currentSongIndex]);
        }
    }

// 淡入/淡出定时器句柄声明在全局变量区（见 gainNode 附近）

    function cancelFadeIn() {
        if (fadeInTimer) {
            clearInterval(fadeInTimer);
            fadeInTimer = null;
        }
    }

    function cancelFadeOut() {
        if (fadeOutTimer) {
            clearInterval(fadeOutTimer);
            fadeOutTimer = null;
        }
    }

// 淡入效果
    function fadeIn(gainNode, callback) {
        const fadeStep = 0.1;
        let currentVolume = gainNode.gain.value;

        cancelFadeOut();
        cancelFadeIn();

        fadeInTimer = setInterval(() => {
            currentVolume = Math.min(currentVolume + fadeStep, 1);
            gainNode.gain.value = currentVolume;
            if (currentVolume >= 1) {
                cancelFadeIn();
                if (callback) {
                    callback();
                }
            }
        }, fadeStep * 1000);
    }

// 淡出效果
    function fadeOut(gainNode, callback) {
        const fadeStep = 0.1;
        let currentVolume = gainNode.gain.value;

        cancelFadeIn();
        cancelFadeOut();

        // 当前音量已是 0 时不会再递减到负数，setInterval 不会自然结束，
        // 这里直接同步完成，避免留下一个永不触发的定时器。
        if (currentVolume <= 0) {
            if (callback) {
                callback();
            }
            return;
        }

        fadeOutTimer = setInterval(() => {
            currentVolume = Math.max(currentVolume - fadeStep, 0);
            gainNode.gain.value = currentVolume;
            if (currentVolume <= 0) {
                cancelFadeOut();
                if (callback) {
                    callback();
                }
            }
        }, fadeStep * 1000);
    }

// 注册媒体会话动作。各平台支持的动作不同（如 seekto 可能不被接受），失败时忽略
    function setMediaActionHandler(action, handler) {
        if (!('mediaSession' in navigator) || !navigator.mediaSession.setActionHandler) return;
        try {
            navigator.mediaSession.setActionHandler(action, handler);
        } catch (e) {
            // 该平台不支持此动作
        }
    }

    // 跳转到指定秒数（供进度条点击、媒体控件 seek 复用）
    // 跳转到指定秒数（进度条点击、媒体控件 seek、方向键微调共用）
    // resumeIfPaused：暂停时是否顺带恢复播放。
    //   true  —— 进度条点击：明确的跳转意图，恢复播放
    //   false —— 方向键微调：只移动播放头，保持暂停
    // maxPerc：进度比例上限。方向键微调传 0.999，避免正好停在 100%
    // 触发"播完"判定——恢复播放时第一个音频量子就会 extract() 返回 0，
    // 经 filter.onEnd() 自动跳到下一首，想听完当前曲会被误跳过。
    // 进度条点击与系统媒体 seek 不传该参数，保持可跳到真正的结尾。
    function seekToTime(seconds, resumeIfPaused, maxPerc) {
        if (!pitchShifter) return;
        const duration = pitchShifter.duration;
        if (!isFinite(duration) || duration <= 0) return;
        const ceiling = (maxPerc === undefined) ? 1 : maxPerc;
        const perc = Math.min(ceiling, Math.max(0, seconds / duration));
        const wasPlaying = isPlaying;
        disconnectPitchShifter();
        pitchShifter.percentagePlayed = perc;

        if (wasPlaying) {
            play();
        } else if (resumeIfPaused) {
            resumeSong();
        } else {
            // 保持暂停：shift 的 timePlayed 变了，但 currentSeek 只在音频量子
            // 里更新，暂停时不会触发。必须手动同步，否则连续按键每次都从
            // 同一个陈旧基准计算，表现为"按一次只走 10 秒"。
            currentSeek = perc * duration;
            // updateProgress 只在播放中（或归零时）更新进度条，暂停时调用它
            // 不会生效，所以这里直接写宽度，让方向键的跳转可见
            progressBar.style.width = `${(currentSeek / duration) * 100}%`;
            // 同步系统媒体控件位置，OS 面板的进度也要跟着动
            updateMediaPosition(currentSeek, duration);
        }
    }

    // 把播放进度同步给系统媒体控件，OS 进度条才能显示并支持拖动
    function updateMediaPosition(currentTime, duration) {
        if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
        if (!isFinite(duration) || duration <= 0) return;
        if (!isFinite(currentTime)) return;   // Math.max(NaN,0) 仍是 NaN，需先挡掉
        const position = Math.min(Math.max(currentTime, 0), duration);
        try {
            // 变速不改变总时长，但源时间相对墙钟的推进速率等于速度倍率
            navigator.mediaSession.setPositionState({
                duration: duration,
                playbackRate: currentTempoShift,
                position: position
            });
        } catch (e) {
            // 位置越界或平台拒绝时忽略
        }
    }

// 更新进度条
    function updateProgress(currentTime, duration) {
        // 无论是否在播放都要同步媒体控件位置，暂停时进度条需要保持不动
        updateMediaPosition(currentTime, duration);
        if (isPlaying || currentTime === 0) // 允许在停止时重置为0
        {
            const progress = (currentTime / duration) * 100;
            progressBar.style.width = `${progress}%`;
        }
    }

// 更新标题
    function updateTitle(songName) {
        const nameWithoutExt = songName.replace(/\.[^/.]+$/, "");
        const titleText = playerTitle.querySelector('.sidebar-title-text');
        if (titleText) {
            titleText.textContent = nameWithoutExt;
            // 重置动画
            titleText.style.animation = 'none';
            titleText.offsetHeight; // 触发重绘
            titleText.style.animation = '';
            // 检测是否溢出，只在溢出时添加 overflow class 以启用 marquee
            const containerWidth = playerTitle.clientWidth;
            const textWidth = titleText.scrollWidth;
            if (textWidth > containerWidth) {
                playerTitle.classList.add('overflow');
                titleText.style.setProperty('--marquee-distance', `-${textWidth - containerWidth + 16}px`);
            } else {
                playerTitle.classList.remove('overflow');
                titleText.style.setProperty('--marquee-distance', '0px');
            }
        } else {
            playerTitle.textContent = nameWithoutExt;
            playerTitle.classList.remove('overflow');
        }
        playerTitle.title = nameWithoutExt;
        document.title = nameWithoutExt;
    }

    // 更新网页图标及媒体元数据
    function updatePageIcon(file, songName) {
        const title = songName ? songName.replace(/\.[^/.]+$/, "") : "Unknown Title";
        const myCoverId = ++coverRequestId;

        if (typeof window.jsmediatags === 'undefined') {
            // jsmediatags 走 CDN，加载失败时不能直接返回：
            // 否则上一首歌的封面、主题色与 favicon 会一直留着。
            resetToDefaultCover(title, myCoverId);
            return;
        }

        window.jsmediatags.read(file, {
            onSuccess: function (tag) {
                if (myCoverId !== coverRequestId) return;
                const {picture} = tag.tags;
                if (picture) {
                    // 有内嵌封面，直接使用
                    processCoverImage(picture, tag, title, myCoverId);
                } else {
                    // 没有内嵌封面，尝试从同文件夹获取 cover.jpg/png
                    tryLoadFolderCover(file, title, tag, myCoverId);
                }
            },
            onError: function (error) {
                if (myCoverId !== coverRequestId) return;
                // 读取标签失败，也尝试从同文件夹获取封面
                tryLoadFolderCover(file, title, null, myCoverId);
            }
        });
    }

    // 尝试从同文件夹加载封面图片 (cover.jpg/cover.png)
    function tryLoadFolderCover(file, title, tag, myCoverId) {
        // 获取当前歌曲的相对路径
        const songPath = file.webkitRelativePath || file.name;
        // 提取文件夹路径（去掉文件名）
        const lastSlashIndex = songPath.lastIndexOf('/');
        const folderPath = lastSlashIndex > -1 ? songPath.substring(0, lastSlashIndex + 1) : '';

        // 尝试的封面文件名列表
        const coverNames = ['cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp', 'folder.jpg', 'folder.png', 'Cover.jpg', 'Cover.png'];

        // 从 allFilesMap 中查找匹配的封面文件
        for (const coverName of coverNames) {
            const coverPath = folderPath + coverName;
            if (allFilesMap.has(coverPath)) {
                // 找到封面文件，读取并显示
                const coverFile = allFilesMap.get(coverPath);
                const reader = new FileReader();
                reader.onload = function (e) {
                    if (myCoverId !== coverRequestId) return;
                    const base64 = e.target.result;
                    applyCoverImage(base64, title, tag, myCoverId);
                };
                reader.onerror = function () {
                    if (myCoverId !== coverRequestId) return;
                    // 读取失败，使用默认
                    resetToDefaultCover(title, myCoverId);
                };
                reader.readAsDataURL(coverFile);
                return;
            }
        }

        // 没有找到封面，使用默认
        resetToDefaultCover(title, myCoverId);
    }

    // 应用封面图片到界面
    function applyCoverImage(base64, title, tag, myCoverId) {
        if (myCoverId !== coverRequestId) return;
        const artist = tag?.tags?.artist || 'Unknown Artist';
        const album = tag?.tags?.album || 'Unknown Album';
        // 尝试从 tag 中获取实际图片格式，否则根据 base64 前缀判断，默认 jpeg
        let imageType = 'image/jpeg';
        if (tag?.tags?.picture?.format) {
            imageType = tag.tags.picture.format;
        } else if (base64.startsWith('data:image/png')) {
            imageType = 'image/png';
        } else if (base64.startsWith('data:image/webp')) {
            imageType = 'image/webp';
        }

        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: title,
                artist: artist,
                album: album,
                artwork: [
                    {src: base64, sizes: '512x512', type: imageType}
                ]
            });
        }

        const img = new Image();
        img.onload = function () {
            if (myCoverId !== coverRequestId) return;
            currentAlbumColor = getAverageColor(img);
            updateThemeBackground();

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const size = 64;
            const radius = 16;
            canvas.width = size;
            canvas.height = size;

            ctx.beginPath();
            ctx.moveTo(radius, 0);
            ctx.lineTo(size - radius, 0);
            ctx.quadraticCurveTo(size, 0, size, radius);
            ctx.lineTo(size, size - radius);
            ctx.quadraticCurveTo(size, size, size - radius, size);
            ctx.lineTo(radius, size);
            ctx.quadraticCurveTo(0, size, 0, size - radius);
            ctx.lineTo(0, radius);
            ctx.quadraticCurveTo(0, 0, radius, 0);
            ctx.closePath();
            ctx.clip();

            ctx.drawImage(img, 0, 0, size, size);
            setAllIcons(canvas.toDataURL('image/png'));
        };
        img.src = base64;

        const albumCoverImg = document.getElementById('album-cover');
        if (albumCoverImg) {
            albumCoverImg.src = base64;
            albumCoverImg.style.display = 'block';
        }
    }

    // 重置为默认封面
    function resetToDefaultCover(title, myCoverId) {
        // 令牌不一致说明期间已切到别的歌曲，不能覆盖新歌的封面状态
        if (myCoverId !== undefined && myCoverId !== coverRequestId) return;
        currentAlbumColor = null;
        updateThemeBackground();
        resetIcons();
        const albumCoverImg = document.getElementById('album-cover');
        if (albumCoverImg) {
            albumCoverImg.src = '';
            albumCoverImg.style.display = 'none';
        }
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: title,
                artist: 'Unknown Artist',
                album: 'Unknown Album'
            });
        }
    }

    // 处理内嵌封面图片
    function processCoverImage(picture, tag, title, myCoverId) {
        if (myCoverId !== coverRequestId) return;
        let base64String = "";
        for (let i = 0; i < picture.data.length; i++) {
            base64String += String.fromCharCode(picture.data[i]);
        }
        const base64 = "data:" + picture.format + ";base64," + window.btoa(base64String);

        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: tag.tags.title || title,
                artist: tag.tags.artist || 'Unknown Artist',
                album: tag.tags.album || 'Unknown Album',
                artwork: [
                    {src: base64, sizes: '512x512', type: picture.format || 'image/png'}
                ]
            });
        }

        const img = new Image();
        img.onload = function () {
            if (myCoverId !== coverRequestId) return;
            currentAlbumColor = getAverageColor(img);
            updateThemeBackground();

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const size = 64;
            const radius = 16;
            canvas.width = size;
            canvas.height = size;

            ctx.beginPath();
            ctx.moveTo(radius, 0);
            ctx.lineTo(size - radius, 0);
            ctx.quadraticCurveTo(size, 0, size, radius);
            ctx.lineTo(size, size - radius);
            ctx.quadraticCurveTo(size, size, size - radius, size);
            ctx.lineTo(radius, size);
            ctx.quadraticCurveTo(0, size, 0, size - radius);
            ctx.lineTo(0, radius);
            ctx.quadraticCurveTo(0, 0, radius, 0);
            ctx.closePath();
            ctx.clip();

            ctx.drawImage(img, 0, 0, size, size);
            setAllIcons(canvas.toDataURL('image/png'));
        };
        img.src = base64;

        const albumCoverImg = document.getElementById('album-cover');
        if (albumCoverImg) {
            albumCoverImg.src = base64;
            albumCoverImg.style.display = 'block';
        }
    }

    // 只匹配 rel 恰好为 "icon" 的 link。
    // rel*='icon' 是子串匹配，会连 rel="apple-touch-icon" 一起命中，
    // 导致 180x180 的 iOS 主屏图标被换成 64x64 的画布图。
    function getIconLinks() {
        return Array.from(document.querySelectorAll("link[rel]"))
            .filter(link => link.getAttribute('rel').trim().toLowerCase() === 'icon');
    }

    function setAllIcons(href) {
        const links = getIconLinks();
        links.forEach(link => link.href = href);

        // 传递给 Electron 主进程更新应用/任务栏图标
        if (window.require) {
            try {
                const {ipcRenderer} = window.require('electron');
                ipcRenderer.send('update-icon', href);
            } catch (e) {
            }
        }
    }

    function resetIcons() {
        const links = getIconLinks();
        links.forEach(link => {
            // 恢复默认图标
            link.href = "./static/img/icon/favicon-32x32.png";
        });

        // 传递给 Electron 主进程恢复默认图标
        if (window.require) {
            try {
                const {ipcRenderer} = window.require('electron');
                ipcRenderer.send('update-icon', null);
            } catch (e) {
            }
        }
    }

    // 滚动到活动歌曲
    function scrollToActiveSong() {
        const songItems = songList.querySelectorAll('.song-item');
        const activeSong = songItems[currentSongIndex];
        if (activeSong) {
            activeSong.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest'
            });
        }
    }

// 断开 PitchShifter 连接
    function disconnectPitchShifter() {
        if (pitchShifter) {
            pitchShifter.disconnect();
        }
    }

    // 小屏幕时点击播放后自动关闭播放列表
    function closeMobilePlaylistIfOpen() {
        if (window.innerWidth <= 800 && sidebarLayout && sidebarLayout.classList.contains('show-mobile')) {
            sidebarLayout.classList.remove('show-mobile');
        }
    }

    // ========== 播放列表扩展接口 ==========
    // 把外部歌曲加入播放列表并切换为当前曲目，返回歌曲对象。
    // 只负责播放列表簿记（去重/下标/渲染/高亮/滚动），实际播放由调用方触发。
    function addSong(songData) {
        if (!songData) return null;

        closeMobilePlaylistIfOpen();

        // 去重检查：检查是否已存在相同歌曲
        const dedupeKey = `${songData.name}|${songData.size}`;
        const existingIndex = songs.findIndex(s => `${s.name}|${s.size}` === dedupeKey);

        if (existingIndex > -1) {
            // 已存在：直接切换到该曲目
            currentSongIndex = existingIndex;
        } else {
            // 不存在：添加到列表顶部
            songs.unshift(songData);
            currentSongIndex = 0;

            // 重新渲染列表
            renderSongList();
        }

        currentSeek = 0;
        currentSong = songs[currentSongIndex];

        // 更新 active 类
        const songItems = songList.querySelectorAll('.song-item');
        songItems.forEach((item, index) => {
            item.classList.toggle('active', index === currentSongIndex);
        });

        // 滚动到正在播放的歌曲
        scrollToActiveSong();

        return currentSong;
    }

    // ========== 播放引擎接口 ==========
    // 开始一次新的播放：使旧的异步加载失效、停掉旧的移调器、恢复音频上下文。
    // 返回本次播放的加载令牌，后续所有异步回调都要用它判断是否已被新请求取代。
    function beginPlayback() {
        const loadToken = ++loadRequestId;

        if (pitchShifter) {
            try {
                // 如果已定义 stop 方法则调用，彻底释放内存
                if (typeof pitchShifter.stop === 'function') {
                    pitchShifter.stop();
                } else {
                    pitchShifter.disconnect();
                }
            } catch (e) {
                console.error("Error stopping pitchShifter:", e);
            }
            pitchShifter = null; // 解除全局引用
        }

        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        // 淡出中的定时器持有的是即将被替换的旧 gainNode：不取消的话它会
        // 继续往已断开的节点写音量，结束时还会触发 pauseSong 的清理回调，
        // 可能把刚接上的新一首给误停。
        cancelFadeIn();
        cancelFadeOut();
        isFadingOut = false;
        createGainNode();

        return loadToken;
    }

    // 加载令牌是否仍是当前有效的一次播放
    function isCurrentLoad(loadToken) {
        return loadToken === loadRequestId;
    }

    // 解码 blob 并开始播放：外部提交的音频数据（非本地文件）的统一入口。
    // 成功 resolve(true)；令牌已失效 resolve(false)；解码/读取失败 reject，
    // 由调用方决定是回退重试还是复位播放器（playbackFailed）。
    // coverLoader: 可选封面加载回调，在移调器就位后调用。
    function playBlob(blob, song, loadToken, coverLoader) {
        return blob.arrayBuffer().then(arrayBuffer => new Promise((resolve, reject) => {
            if (loadToken !== loadRequestId) {
                resolve(false);
                return;
            }
            audioContext.decodeAudioData(arrayBuffer, function (audioBuffer) {
                if (loadToken !== loadRequestId) {
                    resolve(false);
                    return;
                }
                // setupPitchShifter 在解码回调里执行，抛出时不会回到 Promise
                // executor，必须自己捕获并 reject，否则这个 Promise 永远不落定，
                // 调用方的 .catch 与 playbackFailed 都不会触发，播放器卡死。
                try {
                    setupPitchShifter(audioBuffer, song, coverLoader);
                    resolve(true);
                } catch (e) {
                    reject(e || new Error('setup failed'));
                }
            }, function (error) {
                // 令牌已失效时按契约视为"无事发生"，与成功路径的
                // resolve(false) 保持一致；否则过期解码失败会被下一位
                // 调用方误当成真实解码错误。
                if (loadToken !== loadRequestId) {
                    resolve(false);
                    return;
                }
                reject(error || new Error('decode failed'));
            });
        }));
    }

    // 播放失败复位：与本地解码失败走同一条复位路径，
    // 否则会卡在 isPlaying=true / pitchShifter=null 的死状态。
    function playbackFailed(song, err, loadToken) {
        // loadRequestId 从 0 开始自增，令牌只可能是正整数；undefined 表示
        // 调用方未传令牌，此时应当复位，而不是因为 undefined !== loadRequestId
        // 直接 return——那正是本函数要避免的 isPlaying=true 死状态。
        if (loadToken !== undefined && loadToken !== loadRequestId) return;
        handleDecodeError(song, err);
    }

    // ========== 封面竞态令牌 ==========
    function beginCoverLoad() {
        return ++coverRequestId;
    }

    function isCoverCurrent(coverToken) {
        return coverToken === coverRequestId;
    }

    // 注册全局快捷键门控：外部界面可见时由它接管按键，
    // 返回 true 表示主界面快捷键本次应被跳过。
    function setShortcutGate(fn) {
        shortcutGate = (typeof fn === 'function') ? fn : null;
    }

    // 注册歌曲源处理器：用于接管非本地文件来源的歌曲
    function setSongSourceHandler(handler) {
        songSourceHandler = (handler && typeof handler.play === 'function') ? handler : null;
    }

    // 设置 PitchShifter 并开始播放
    function setupPitchShifter(audioBuffer, song, coverLoader) {
        const bufferSize = 16384;
        const ps = new PitchShifter(audioContext, audioBuffer, bufferSize);
        pitchShifter = ps;
        ps.pitch = Math.pow(2.0, currentPitchShift / 12.0);
        ps.tempo = currentTempoShift;
        ps.on('play', (detail) => {
            currentSeek = parseFloat(detail.timePlayed);
            updateProgress(currentSeek, ps.duration);
            // 必须比较数值：formattedTimePlayed 是 "M:SS" 字符串，
            // 与 "MM:SS" 做字典序比较会因 ':' > 数字而在 1~9 分钟处误判为播完
            if (detail.timePlayed >= ps.duration) {
                if (isLooping) {
                    ps.percentagePlayed = 0;
                    currentSeek = 0;
                } else {
                    handleNextSong();
                }
            }
        });

        play();

        updateTitle(song.name);

        // 加载封面：外部播放通过 coverLoader 注入，本地歌曲读内嵌/文件夹封面
        if (typeof coverLoader === 'function') {
            coverLoader(song);
        } else {
            updatePageIcon(song.file, song.name);
        }

        scrollToActiveSong();

        const songItems = songList.querySelectorAll('.song-item');
        songItems.forEach((item, index) => {
            item.classList.toggle('active', index === currentSongIndex);
        });
    }

    // 把封面应用到界面：mediaSession 元数据 + 主题色 + favicon + 封面图
    // meta: {title, artist, album}，由调用方提供，引擎本身不感知数据来源
    function applyCover(base64, song, coverToken, meta) {
        if (coverToken !== coverRequestId) return;
        const title = (meta && meta.title) || song.name.replace(/\.[^/.]+$/, "");
        const artist = (meta && meta.artist) || 'Unknown Artist';
        const album = (meta && meta.album) || 'Unknown Album';

        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: title,
                artist: artist,
                album: album,
                artwork: [
                    {src: base64, sizes: '512x512', type: 'image/jpeg'}
                ]
            });
        }

        const img = new Image();
        img.onload = function () {
            if (coverToken !== coverRequestId) return;
            currentAlbumColor = getAverageColor(img);
            updateThemeBackground();

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const size = 64;
            const radius = 16;
            canvas.width = size;
            canvas.height = size;

            ctx.beginPath();
            ctx.moveTo(radius, 0);
            ctx.lineTo(size - radius, 0);
            ctx.quadraticCurveTo(size, 0, size, radius);
            ctx.lineTo(size, size - radius);
            ctx.quadraticCurveTo(size, size, size - radius, size);
            ctx.lineTo(radius, size);
            ctx.quadraticCurveTo(0, size, 0, size - radius);
            ctx.lineTo(0, radius);
            ctx.quadraticCurveTo(0, 0, radius, 0);
            ctx.closePath();
            ctx.clip();

            ctx.drawImage(img, 0, 0, size, size);
            setAllIcons(canvas.toDataURL('image/png'));
        };
        img.src = base64;

        const albumCoverImg = document.getElementById('album-cover');
        if (albumCoverImg) {
            albumCoverImg.src = base64;
            albumCoverImg.style.display = 'block';
        }
    }

    // 应用默认封面（无封面时）：清空封面图与主题色，仅保留元数据
    function applyDefaultCover(song, coverToken, meta) {
        if (coverToken !== undefined && coverToken !== coverRequestId) return;
        const title = (meta && meta.title) || song.name.replace(/\.[^/.]+$/, "");
        const artist = (meta && meta.artist) || 'Unknown Artist';
        const album = (meta && meta.album) || 'Unknown Album';

        currentAlbumColor = null;
        updateThemeBackground();
        resetIcons();
        const albumCoverImg = document.getElementById('album-cover');
        if (albumCoverImg) {
            albumCoverImg.src = '';
            albumCoverImg.style.display = 'none';
        }
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: title,
                artist: artist,
                album: album
            });
        }
    }

    initTheme();
    setupAudioPlayer();

    document.addEventListener('keydown', function (event) {
        if (!event.key) {
            return;
        }

        // 已注册的快捷键门控（通过 setShortcutGate 注册）：
        // 返回 true 表示本次按键由注册方接管，主界面快捷键全部跳过。
        if (shortcutGate && shortcutGate(event)) {
            return;
        }

        const key = event.key.toLowerCase();
        if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
            return;
        }
        if (document.activeElement === searchInput && key !== 'escape') {
            return;
        }
        switch (key) {
            case ' ':
            case 'enter':
                event.preventDefault();
                handlePlayPause();
                break;
            case 'delete':
            case 'backspace':
                if (document.activeElement !== searchInput) {
                    // 只在多选模式下才响应删除快捷键
                    if (!multiSelectMode) return;
                    event.preventDefault();
                    if (selectedSongs.size > 0) {
                        const playingSong = songs[currentSongIndex];
                        let removedPlaying = false;
                        let playingSongOriginalIndex = currentSongIndex;

                        const allItems = Array.from(songList.querySelectorAll('.song-item'));
                        const indicesToRemove = [];
                        allItems.forEach((item, index) => {
                            if (item.classList.contains('selected')) {
                                if (index === currentSongIndex) {
                                    removedPlaying = true;
                                }
                                indicesToRemove.push(index);
                            }
                        });

                        indicesToRemove.sort((a, b) => b - a);

                        indicesToRemove.forEach(indexToRemove => {
                            songs.splice(indexToRemove, 1);
                        });

                        renderSongList();

                        selectedSongs.clear();
                        lastSelectedSong = null;
                        updatePlaylistActions();

                        if (songs.length === 0) {
                            currentSongIndex = 0;
                            currentSong = null;
                            resetToEmptyPlaylistState();
                        } else {
                            if (removedPlaying) {
                                currentSongIndex = Math.min(playingSongOriginalIndex, songs.length - 1);
                                currentSeek = 0;
                                playSong(songs[currentSongIndex]);
                            } else {
                                currentSongIndex = songs.indexOf(playingSong);
                                if (currentSongIndex === -1) {
                                    currentSongIndex = 0;
                                    // 原当前歌曲已被删除，同步引用避免指向不存在的歌曲
                                    currentSong = songs[0] || null;
                                }
                            }
                        }

                        const songItems = songList.querySelectorAll('.song-item');
                        songItems.forEach((item, index) => {
                            item.classList.toggle('active', index === currentSongIndex);
                        });
                    }
                }
                break;
            case 'arrowleft':
                if (pitchShifter) {
                    event.preventDefault();
                    // 走 seekToTime 以正确累积：原实现直接写 percentagePlayed，
                    // 既不更新 currentSeek（暂停时按一次只走 10 秒），
                    // 也不刷新进度条（暂停时看起来毫无反应）
                    // 上限 0.999：不跳到真正的结尾，避免恢复播放时误触发自动下一首
                    seekToTime(currentSeek - 10, false, 0.999);
                }
                break;
            case 'arrowup':
                event.preventDefault();
                handlePrevSong();
                break;
            case 'pageup':
                event.preventDefault();
                if (parseFloat(pitchShiftSelect.value) < parseFloat(pitchShiftSelect.max)) {
                    pitchShiftSelect.value = parseFloat(pitchShiftSelect.value) + 1;
                    pitchShiftSelect.dispatchEvent(new Event('input'));
                }
                break;
            case 'arrowright':
                if (pitchShifter) {
                    event.preventDefault();
                    seekToTime(currentSeek + 10, false, 0.999);
                }
                break;
            case 'arrowdown':
                event.preventDefault();
                handleNextSong();
                break;
            case 'pagedown':
                event.preventDefault();
                if (parseFloat(pitchShiftSelect.value) > parseFloat(pitchShiftSelect.min)) {
                    pitchShiftSelect.value = parseFloat(pitchShiftSelect.value) - 1;
                    pitchShiftSelect.dispatchEvent(new Event('input'));
                }
                break;
            case 'r':
            case 's':
                event.preventDefault();
                handleRandomToggle();
                break;
            case 'l':
                event.preventDefault();
                handleLoopToggle();
                break;
            case '+':
            case '=':
                event.preventDefault();
                if (parseFloat(tempoShiftSelect.value) < parseFloat(tempoShiftSelect.max)) {
                    tempoShiftSelect.value = (parseFloat(tempoShiftSelect.value) + 0.1).toFixed(1);
                    tempoShiftSelect.dispatchEvent(new Event('input'));
                }
                break;
            case '-':
            case '_':
                event.preventDefault();
                if (parseFloat(tempoShiftSelect.value) > parseFloat(tempoShiftSelect.min)) {
                    tempoShiftSelect.value = (parseFloat(tempoShiftSelect.value) - 0.1).toFixed(1);
                    tempoShiftSelect.dispatchEvent(new Event('input'));
                }
                break;
            case 'escape':
                event.preventDefault();
                searchInput.value = '';
                searchInput.blur();
                handleSearchInput();
                scrollToActiveSong();
                break;
            case 'f':
                scrollToActiveSong();
                event.preventDefault();
                searchInput.focus();
                break;
            case 't':
                event.preventDefault();
                toggleTheme();
                break;
        }
    });

    function preventMobileZoom() {
        document.addEventListener('gesturestart', function (e) {
            e.preventDefault();
        });

        document.addEventListener('touchmove', function (event) {
            if (event.touches.length > 1) {
                event.preventDefault();
            }
        }, {passive: false});
    }

    preventMobileZoom();

    // 导出通用播放引擎接口，供外部注册与调用。
    // 契约：
    //   addSong(songData)                  播放列表簿记，返回歌曲对象
    //   beginPlayback() -> loadToken       开始一次播放并使旧异步请求失效
    //   isCurrentLoad(loadToken)           令牌是否仍是当前播放
    //   playBlob(blob, song, token, coverLoader)  解码并播放外部音频
    //   playbackFailed(song, err, token)   播放失败复位
    //   beginCoverLoad()/isCoverCurrent()  封面竞态令牌
    //   applyCover(base64, song, token, meta) / applyDefaultCover(song, token, meta)
    //   setShortcutGate(fn)                全局快捷键门控
    //   setSongSourceHandler(handler)      歌曲源处理器 {canHandle, play}
    window.MainPlayer = {
        addSong: addSong,
        beginPlayback: beginPlayback,
        isCurrentLoad: isCurrentLoad,
        playBlob: playBlob,
        playbackFailed: playbackFailed,
        beginCoverLoad: beginCoverLoad,
        isCoverCurrent: isCoverCurrent,
        applyCover: applyCover,
        applyDefaultCover: applyDefaultCover,
        setShortcutGate: setShortcutGate,
        setSongSourceHandler: setSongSourceHandler,
    };
})
