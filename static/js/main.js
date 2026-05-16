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
    let pitchShifter;
    let gainNode;
    let loadRequestId = 0;
    let currentAlbumColor = null; // null或 "r, g, b"
    let currentDisplayColor = null; // 经过当前明暗主题优化后的展示色
    let activeThemeIndex = 1;     // 用于在主题渐变伪元素之间切换 (1 或 2)
    let allFilesMap = new Map();  // 保存所有文件（包括图片），用于查找封面

    // 更新界面背景渐变
    function updateThemeBackground() {
        const progressBar = document.getElementById('progress-bar');
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

            if (progressBar) {
                progressBar.classList.remove(`theme-bg-${activeThemeIndex}`);
                progressBar.classList.add(`theme-bg-${newIndex}`);
            }

            activeThemeIndex = newIndex;

        } else {
            document.body.classList.remove('theme-bg-1', 'theme-bg-2');
            if (progressBar) progressBar.classList.remove('theme-bg-1', 'theme-bg-2');

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

    let play = function () {
        pitchShifter.connect(gainNode);
        gainNode.connect(analyserNode);
        analyserNode.connect(audioContext.destination);
        audioContext.resume().then(() => {
            isPlaying = true;
            playPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
            i18n.updatePageTexts();
            if (!visualizerAnimationFrame) {
                drawVisualizer();
            }
            if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = 'playing';
            }
        });
    };

    function drawVisualizer() {
        if (!visualizerCanvas || !visualizerCtx) return;
        visualizerAnimationFrame = requestAnimationFrame(drawVisualizer);

        const width = visualizerCanvas.clientWidth;
        const height = visualizerCanvas.clientHeight;
        if (visualizerCanvas.width !== width || visualizerCanvas.height !== height) {
            visualizerCanvas.width = width;
            visualizerCanvas.height = height;
        }

        const bufferLength = analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserNode.getByteFrequencyData(dataArray);

        visualizerCtx.clearRect(0, 0, width, height);

        const currentTheme = document.documentElement.getAttribute('data-theme');
        const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const isDark = currentTheme === 'dark' || (!currentTheme && isSystemDark);

        // 使用专辑封面色或融入背景的颜色 (配合透明度使用)
        const baseColor = currentDisplayColor ? currentDisplayColor : (isDark ? '255, 255, 255' : '100, 116, 139');

        const sliceWidth = width * 1.0 / bufferLength;
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
                if(window.innerWidth <= 800 && sidebarLayout.classList.contains('show-mobile')){
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

        // 拖拽事件绑定到 document，确保从外部拖入文件时能正确触发
        document.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.stopPropagation();
            dragDropZone.classList.add('dragover');
        });

        document.addEventListener('dragleave', function(e) {
            e.preventDefault();
            e.stopPropagation();
            // 只有当鼠标真正离开窗口时才移除 dragover 样式
            if (e.relatedTarget === null || e.relatedTarget === document.documentElement) {
                dragDropZone.classList.remove('dragover');
            }
        });

        document.addEventListener('drop', function(e) {
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
                    songList.innerHTML = '';
                    songs.forEach(song => {
                        const listItem = createSongListItem(song);
                        songList.appendChild(listItem);
                    });

                    selectedSongs.clear();
                    lastSelectedSong = null;
                    updatePlaylistActions();

                    if (songs.length === 0) {
                        currentSongIndex = 0;
                        // 停止播放并重置所有状态
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
                        playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
                        i18n.updatePageTexts();
                        if ('mediaSession' in navigator) {
                            navigator.mediaSession.playbackState = 'paused';
                        }
                        // 重置进度条
                        progressBar.style.width = '0%';
                        // 恢复默认配色
                        currentAlbumColor = null;
                        updateThemeBackground();
                        // 恢复默认图标
                        resetIcons();
                        // 恢复默认标题
                        const titleText1 = playerTitle.querySelector('.sidebar-title-text');
                        if (titleText1) {
                            titleText1.textContent = 'Music Player';
                            titleText1.style.setProperty('--marquee-distance', '0px');
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
                            if (currentSongIndex === -1) currentSongIndex = 0;
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
            navigator.mediaSession.setActionHandler('play', () => {
                if (!isPlaying) resumeSong();
            });
            navigator.mediaSession.setActionHandler('pause', () => {
                if (isPlaying) pauseSong();
            });
            navigator.mediaSession.setActionHandler('previoustrack', handlePrevSong);
            navigator.mediaSession.setActionHandler('nexttrack', handleNextSong);
        }

        if (multiSelectBtn) {
            multiSelectBtn.addEventListener('click', () => {
                multiSelectMode = !multiSelectMode;
                multiSelectBtn.classList.toggle('active', multiSelectMode);
                songList.classList.toggle('multi-select-mode', multiSelectMode);
                if (multiSelectMode) {
                    if(selectAllBtn) selectAllBtn.classList.remove('hidden');
                    updatePlaylistActions();
                } else {
                    if(selectAllBtn) selectAllBtn.classList.add('hidden');
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
                const songItems = Array.from(songList.querySelectorAll('.song-item')).filter(i => i.style.display !== 'none');
                const allSelected = songItems.every(i => i.classList.contains('selected'));

                if (allSelected) {
                    songItems.forEach(item => {
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
                    const allItems = Array.from(songList.querySelectorAll('.song-item'));
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
        const playingSong = isPlaying ? songs[currentSongIndex] : null;
        const wasEmpty = songs.length === 0;

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
                // 检查歌曲列表中是否已有相同路径的文件
                const existingIndex = songs.findIndex(s => s.path === filePath);
                if (existingIndex > -1) {
                    // 已存在：移动到顶部
                    const existingSong = songs[existingIndex];
                    songs.splice(existingIndex, 1);
                    songs.unshift(existingSong);
                } else {
                    // 不存在：添加新歌曲，同时存储路径用于去重
                    newSongs.push({name: file.name, path: filePath, file: file});
                }
            }
        });

        // 如果有新歌曲，添加到数组顶部
        if (newSongs.length > 0) {
            songs.unshift(...newSongs);
        }

        // 如果有任何变化（新歌曲或移动的歌曲）
        if (newSongs.length > 0) {
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
            songList.innerHTML = '';
            songs.forEach(song => {
                const listItem = createSongListItem(song);
                songList.appendChild(listItem);
            });

            // 更新当前播放索引：重新查找正在播放的歌曲在新列表中的位置
            if (playingSong) {
                currentSongIndex = songs.indexOf(playingSong);
                if (currentSongIndex === -1) currentSongIndex = 0;
            } else if (wasEmpty && songs.length > 0) {
                // 列表之前为空，添加新歌曲后自动播放第一首
                currentSongIndex = 0;
                playSong(songs[currentSongIndex]);
            }

            // Re-bind active classes
            const songItems = songList.querySelectorAll('.song-item');
            songItems.forEach((item, index) => {
                item.classList.toggle('active', index === currentSongIndex);
            });
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
        listItem.innerHTML = `<i class="fa-solid fa-music"></i><span class="song-item-title" title="${song.name}">${song.name}</span>`;

        listItem.addEventListener('click', (e) => {
            const index = songs.indexOf(song);
            if (multiSelectMode || e.ctrlKey || e.metaKey || e.shiftKey) {
                if (selectedSongs.has(song)) {
                    selectedSongs.delete(song);
                    listItem.classList.remove('selected');
                } else {
                    selectedSongs.add(song);
                    listItem.classList.add('selected');
                }
                lastSelectedSong = song;
            } else if (e.shiftKey && lastSelectedSong) {
                const lastIndex = songs.indexOf(lastSelectedSong);
                const start = Math.min(lastIndex, index);
                const end = Math.max(lastIndex, index);
                selectedSongs.clear();
                const allItems = songList.querySelectorAll('.song-item');
                allItems.forEach(i => i.classList.remove('selected'));
                for (let i = start; i <= end; i++) {
                    selectedSongs.add(songs[i]);
                    allItems[i].classList.add('selected');
                }
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
                const playingSong = songs[currentSongIndex];

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
                currentSongIndex = songs.indexOf(playingSong);
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
        if (pitchShiftVal) {
            pitchShiftVal.textContent = currentPitchShift > 0 ? '+' + currentPitchShift : currentPitchShift;
        }
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

        // 搜索内容变化时（包括清空），滚动到当前播放歌曲
        scrollToActiveSong();
    }

// 播放歌曲
    function playSong(song) {
        if (!song) return;

        // 小屏幕时点击播放后自动关闭播放列表
        if (window.innerWidth <= 800 && sidebarLayout && sidebarLayout.classList.contains('show-mobile')) {
            sidebarLayout.classList.remove('show-mobile');
        }

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
                updatePageIcon(song.file, song.name); // 新增：更新网页图标及媒体会话信息
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
                playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
                i18n.updatePageTexts();
                if ('mediaSession' in navigator) {
                    navigator.mediaSession.playbackState = 'paused';
                }
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

        if (typeof window.jsmediatags === 'undefined') {
            if ('mediaSession' in navigator) {
                navigator.mediaSession.metadata = new MediaMetadata({title: title});
            }
            return;
        }

        window.jsmediatags.read(file, {
            onSuccess: function (tag) {
                const {picture} = tag.tags;
                if (picture) {
                    // 有内嵌封面，直接使用
                    processCoverImage(picture, tag, title);
                } else {
                    // 没有内嵌封面，尝试从同文件夹获取 cover.jpg/png
                    tryLoadFolderCover(file, title, tag);
                }
            },
            onError: function (error) {
                // 读取标签失败，也尝试从同文件夹获取封面
                tryLoadFolderCover(file, title, null);
            }
        });
    }

    // 尝试从同文件夹加载封面图片 (cover.jpg/cover.png)
    function tryLoadFolderCover(file, title, tag) {
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
                reader.onload = function(e) {
                    const base64 = e.target.result;
                    applyCoverImage(base64, title, tag);
                };
                reader.onerror = function() {
                    // 读取失败，使用默认
                    resetToDefaultCover(title);
                };
                reader.readAsDataURL(coverFile);
                return;
            }
        }

        // 没有找到封面，使用默认
        resetToDefaultCover(title);
    }

    // 应用封面图片到界面
    function applyCoverImage(base64, title, tag) {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: tag?.tags?.title || title,
                artist: tag?.tags?.artist || 'Unknown Artist',
                album: tag?.tags?.album || 'Unknown Album',
                artwork: [
                    {src: base64, sizes: '512x512', type: 'image/jpeg'}
                ]
            });
        }

        const img = new Image();
        img.onload = function () {
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
    function resetToDefaultCover(title) {
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
    function processCoverImage(picture, tag, title) {
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

    function setAllIcons(href) {
        const links = document.querySelectorAll("link[rel*='icon']");
        links.forEach(link => link.href = href);

        // 传递给 Electron 主进程更新应用/任务栏图标
        if (window.require) {
            try {
                const { ipcRenderer } = window.require('electron');
                ipcRenderer.send('update-icon', href);
            } catch(e) {}
        }
    }

    function resetIcons() {
        const links = document.querySelectorAll("link[rel*='icon']");
        links.forEach(link => {
            // 恢复默认图标
            link.href = "./static/img/icon/favicon-32x32.png";
        });

        // 传递给 Electron 主进程恢复默认图标
        if (window.require) {
            try {
                const { ipcRenderer } = window.require('electron');
                ipcRenderer.send('update-icon', null);
            } catch(e) {}
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

    initTheme();
    setupAudioPlayer();

    document.addEventListener('keydown', function (event) {
        if (!event.key) {
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

                        songList.innerHTML = '';
                        songs.forEach(song => {
                            const listItem = createSongListItem(song);
                            songList.appendChild(listItem);
                        });

                        selectedSongs.clear();
                        lastSelectedSong = null;
                        updatePlaylistActions();

                        if (songs.length === 0) {
                            currentSongIndex = 0;
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
                            playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
                            i18n.updatePageTexts();
                            if ('mediaSession' in navigator) {
                                navigator.mediaSession.playbackState = 'paused';
                            }
                            progressBar.style.width = '0%';
                            currentAlbumColor = null;
                            updateThemeBackground();
                            resetIcons();
                            // 恢复默认标题
                            const titleText1 = playerTitle.querySelector('.sidebar-title-text');
                            if (titleText1) {
                                titleText1.textContent = 'Music Player';
                                titleText1.style.setProperty('--marquee-distance', '0px');
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
                        } else {
                            if (removedPlaying) {
                                currentSongIndex = Math.min(playingSongOriginalIndex, songs.length - 1);
                                currentSeek = 0;
                                playSong(songs[currentSongIndex]);
                            } else {
                                currentSongIndex = songs.indexOf(playingSong);
                                if (currentSongIndex === -1) currentSongIndex = 0;
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
                    pitchShifter.percentagePlayed = Math.max(0, (currentSeek - 10) / pitchShifter.duration);
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
                    pitchShifter.percentagePlayed = Math.min(0.999, (currentSeek + 10) / pitchShifter.duration);
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
})
