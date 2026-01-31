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
    }

    clone() {
        const result = new RateTransposer();
        result.rate = this._rate;
        return result;
    }

    process() {
        const numFrames = this._inputBuffer.frameCount;
        this._outputBuffer.ensureAdditionalCapacity(numFrames / this._rate + 1);
        const numFramesOutput = this.transpose(numFrames);
        this._inputBuffer.receive();
        this._outputBuffer.put(numFramesOutput);
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
                dest[destOffset + 2 * i] = (1.0 - this.slopeCount) * src[srcIndex] + this.slopeCount * src[srcIndex + 2];
                dest[destOffset + 2 * i + 1] = (1.0 - this.slopeCount) * src[srcIndex + 1] + this.slopeCount * src[srcIndex + 3];
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
        this.inputBuffer.putSamples(samples, 0, numFramesExtracted);
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
    }
}

const USE_AUTO_SEQUENCE_LEN = 0;
const DEFAULT_SEQUENCE_MS = USE_AUTO_SEQUENCE_LEN;
const USE_AUTO_SEEKWINDOW_LEN = 0;
const DEFAULT_SEEKWINDOW_MS = USE_AUTO_SEEKWINDOW_LEN;
const DEFAULT_OVERLAP_MS = 8;
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
        const frameScale = 1 / this.overlapLength;
        let fi;
        let inputOffset;
        let outputOffset;
        for (; i < this.overlapLength; i = i + 1) {
            tempFrame = (this.overlapLength - i) * frameScale;
            fi = i * frameScale;
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
    const progress = document.getElementById('progress');
    const progressBar = document.getElementById('progress-bar');
    const playerTitle = document.getElementById('player-title');
    const searchInput = document.getElementById('search-input');

// 全局变量
    let songs = [];
    let currentSongIndex = 0;
    let isPlaying = false;
    let isLooping = false;
    let isRandom = false;
    let currentSeek = 0;
    let currentPitchShift = 0;
    let currentTempoShift = 1;
    let audioContext = new window.AudioContext(); // 只创建一次 AudioContext
    let pitchShifter;
    let gainNode;
    let loadRequestId = 0;
    let play = function () {
        pitchShifter.connect(gainNode);
        gainNode.connect(audioContext.destination);
        audioContext.resume().then(() => {
            isPlaying = true;
            playPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i> <span data-i18n="pause">暂停</span>';
            i18n.updatePageTexts();
        });
    };

// 初始化音频播放器
    function setupAudioPlayer() {
        folderInput.addEventListener('change', handleFolderInputChange);
        singleInput.addEventListener('change', function () {
            const files = singleInput.files;
            processDroppedFiles(files);
        });
        dragDropZone.addEventListener('dragover', handleDragOver);
        dragDropZone.addEventListener('dragleave', handleDragLeave);
        dragDropZone.addEventListener('drop', handleDropEvent);

        playPauseBtn.addEventListener('click', handlePlayPause);
        prevBtn.addEventListener('click', handlePrevSong);
        nextBtn.addEventListener('click', handleNextSong);
        randomBtn.addEventListener('click', handleRandomToggle);
        loopBtn.addEventListener('click', handleLoopToggle);
        pitchShiftSelect.addEventListener('change', handlePitchShiftChange);
        tempoShiftSelect.addEventListener('change', function () {
            currentTempoShift = parseFloat(tempoShiftSelect.value);
            if (pitchShifter) {
                pitchShifter.tempo = currentTempoShift;
            }
        });
        progress.addEventListener('click', function (event) {
            if (!pitchShifter) return;
            const rect = progress.getBoundingClientRect();
            const clickX = event.clientX - rect.left;
            const progressWidth = rect.width;
            const perc = clickX / progressWidth;
            if (isPlaying) {
                pitchShifter.disconnect();
                pitchShifter.percentagePlayed = perc;
                play()
            } else {
                pitchShifter.disconnect();
                pitchShifter.percentagePlayed = perc;
                resumeSong()
            }
        });
        searchInput.addEventListener('input', handleSearchInput);
    }

    function handleDragOver(e) {
        e.preventDefault(); // 阻止浏览器默认行为（否则无法触发drop事件）
        e.stopPropagation();
        dragDropZone.classList.add('dragover'); // 添加拖拽状态样式
    }

    function handleDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        dragDropZone.classList.remove('dragover'); // 移除拖拽状态样式
    }

    function handleDropEvent(e) {
        e.preventDefault();
        e.stopPropagation();
        dragDropZone.classList.remove('dragover'); // 移除拖拽状态样式

        const files = e.dataTransfer.files; // 获取拖拽的文件列表
        if (files.length === 0) return;

        // 处理拖拽的文件（支持单个/多个文件，文件夹需浏览器支持）
        processDroppedFiles(files);
    }

// ====================== 文件处理通用函数 ======================
    function processDroppedFiles(files) {
        let hasAudioFiles = false;
        // 检查是否有音频文件
        Array.from(files).forEach(file => {
            if (file.type.startsWith('audio/')) {
                hasAudioFiles = true;
            }
        });

        // 只有存在音频文件时才清空现有列表
        if (hasAudioFiles) {
            songs = [];
            songList.innerHTML = '';
        }

        Array.from(files).forEach(file => {
            // 过滤非音频文件（根据扩展名或MIME类型）
            if (file.type.startsWith('audio/')) {
                const song = {name: file.name, file: file};
                songs.push(song);
                const listItem = createSongListItem(song);
                songList.appendChild(listItem);
            }
        });

        // 自动播放第一个文件（可选）
        if (songs.length > 0 && !isPlaying) {
            currentSongIndex = 0;
            playSong(songs[currentSongIndex]);
        }
    }

// 处理文件夹输入变化
    function handleFolderInputChange(event) {
        const files = event.target.files;
        processDroppedFiles(files);
    }

// 创建歌曲列表项
    function createSongListItem(song) {
        const listItem = document.createElement('div');
        listItem.classList.add('song-item');
        listItem.textContent = song.name;
        listItem.addEventListener('click', () => {
            currentSongIndex = songs.indexOf(song);
            currentSeek = 0;
            playSong(song);
        });
        return listItem;
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
        disconnectPitchShifter();
        currentSongIndex = (currentSongIndex - 1 + songs.length) % songs.length;
        currentSeek = 0;
        playSong(songs[currentSongIndex]);
    }

// 处理下一首按钮点击
    function handleNextSong() {
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
        if (pitchShifter) {
            pitchShifter.pitch = Math.pow(2.0, currentPitchShift / 12.0);
        }
    }

// 处理搜索输入
    function handleSearchInput() {
        const searchTerm = searchInput.value.trim().toLowerCase();
        const songItems = songList.querySelectorAll('.song-item');
        let hasMatch = false;

        songItems.forEach((item) => {
            const songName = item.textContent.toLowerCase();
            if (searchTerm === '' || songName.includes(searchTerm)) {
                item.style.display = 'block';
                hasMatch = true;
            } else {
                item.style.display = 'none';
            }
        });

        if (!hasMatch && searchTerm !== '') {
            searchInput.classList.add('error');
            songItems.forEach((item) => {
                item.style.display = 'block';
            });
        } else {
            searchInput.classList.remove('error');
        }
    }

// 播放歌曲
    function playSong(song) {
        if (!song) return;

        const currentRequestId = ++loadRequestId;

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
        gainNode = audioContext.createGain();

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
                    if (detail.formattedTimePlayed >= ps.formattedDuration) {
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
                scrollToActiveSong();

                const songItems = songList.querySelectorAll('.song-item');
                songItems.forEach((item, index) => {
                    item.classList.toggle('active', index === currentSongIndex);
                });

            }, function (error) {
                console.log("Filereader error: " + error.err);
            });
        };
        reader.readAsArrayBuffer(song.file);
    }

// 暂停歌曲
    function pauseSong() {
        if (pitchShifter) {
            fadeOut(gainNode, () => {
                disconnectPitchShifter();
                isPlaying = false;
                playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i> <span data-i18n="play">播放</span>';
                i18n.updatePageTexts();
            });
        }
    }

// 播放歌曲
    function resumeSong() {
        if (pitchShifter) {
            play();
            // console.log(gainNode.gain.value)
            fadeIn(gainNode)
        } else {
            playSong(songs[currentSongIndex]);
        }
    }

// 淡入效果
    function fadeIn(gainNode, callback) {
        const fadeStep = 0.1;
        let currentVolume = gainNode.gain.value;

        const fadeInInterval = setInterval(() => {
            currentVolume = Math.min(currentVolume + fadeStep, 1);
            gainNode.gain.value = currentVolume;
            if (currentVolume >= 1) {
                clearInterval(fadeInInterval);
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

        const fadeOutInterval = setInterval(() => {
            currentVolume = Math.max(currentVolume - fadeStep, 0);
            gainNode.gain.value = currentVolume;
            if (currentVolume <= 0) {
                clearInterval(fadeOutInterval);
                if (callback) {
                    callback();
                }
            }
        }, fadeStep * 1000);
    }

// 更新进度条
    function updateProgress(currentTime, duration) {
        if (isPlaying || currentTime === 0) { // 允许在停止时重置为0
            const progress = (currentTime / duration) * 100;
            progressBar.style.width = `${progress}%`;
        }
    }

// 更新标题
    function updateTitle(songName) {
        playerTitle.textContent = songName;
        document.title = songName;
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

    setupAudioPlayer();

    document.addEventListener('keydown', function (event) {
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
                playPauseBtn.click()
                break;
            case 'arrowleft':
                event.preventDefault();
                prevBtn.click()
                break;
            case 'pageup':
                event.preventDefault();
                if (pitchShiftSelect.selectedIndex < pitchShiftSelect.options.length - 1) {
                    pitchShiftSelect.selectedIndex += 1;
                    pitchShiftSelect.dispatchEvent(new Event('change'));
                }
                break;
            case 'arrowright':
                event.preventDefault();
                nextBtn.click()
                break;
            case 'pagedown':
                event.preventDefault();
                if (pitchShiftSelect.selectedIndex > 0) {
                    pitchShiftSelect.selectedIndex -= 1;
                    pitchShiftSelect.dispatchEvent(new Event('change'));
                }
                break;
            case 'r':
            case 's':
                event.preventDefault();
                randomBtn.click()
                break;
            case 'l':
                event.preventDefault();
                loopBtn.click()
                break;
            case '+':
            case '=':
                event.preventDefault();
                if (tempoShiftSelect.selectedIndex < tempoShiftSelect.options.length - 1) {
                    tempoShiftSelect.selectedIndex += 1;
                    tempoShiftSelect.dispatchEvent(new Event('change'));
                }
                break;
            case '-':
            case '_':
                event.preventDefault();
                if (tempoShiftSelect.selectedIndex > 0) {
                    tempoShiftSelect.selectedIndex -= 1;
                    tempoShiftSelect.dispatchEvent(new Event('change'));
                }
                break;
            case 'escape':
                event.preventDefault();
                searchInput.value = '';
                handleSearchInput();
                scrollToActiveSong();
                break;
            case 'f':
                scrollToActiveSong();
                event.preventDefault();
                searchInput.focus();
                break;
        }
    });

    function preventMobileZoom() {
        // 阻止 Safari 的 gesturestart (防止双指缩放手势)
        document.addEventListener('gesturestart', function (e) {
            e.preventDefault();
        });

        // 阻止双击缩放
        document.addEventListener('touchmove', function (event) {
            if (event.touches.length > 1) {
                event.preventDefault();
            }
        }, {passive: false}); // 必须设置为 postive: false 才能调用 preventDefault
    }

    preventMobileZoom();
})