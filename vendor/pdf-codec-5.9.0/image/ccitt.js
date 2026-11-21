import { concatBytes } from "../bytes/writer.js";
//#region src/image/ccitt.ts
function toRunCodeTuples(codes) {
	return codes.map((c) => [c.bits, c.run]);
}
const WHITE_TERMINATING_AND_MAKEUP = toRunCodeTuples([
	{
		bits: "00110101",
		run: 0
	},
	{
		bits: "000111",
		run: 1
	},
	{
		bits: "0111",
		run: 2
	},
	{
		bits: "1000",
		run: 3
	},
	{
		bits: "1011",
		run: 4
	},
	{
		bits: "1100",
		run: 5
	},
	{
		bits: "1110",
		run: 6
	},
	{
		bits: "1111",
		run: 7
	},
	{
		bits: "10011",
		run: 8
	},
	{
		bits: "10100",
		run: 9
	},
	{
		bits: "00111",
		run: 10
	},
	{
		bits: "01000",
		run: 11
	},
	{
		bits: "001000",
		run: 12
	},
	{
		bits: "000011",
		run: 13
	},
	{
		bits: "110100",
		run: 14
	},
	{
		bits: "110101",
		run: 15
	},
	{
		bits: "101010",
		run: 16
	},
	{
		bits: "101011",
		run: 17
	},
	{
		bits: "0100111",
		run: 18
	},
	{
		bits: "0001100",
		run: 19
	},
	{
		bits: "0001000",
		run: 20
	},
	{
		bits: "0010111",
		run: 21
	},
	{
		bits: "0000011",
		run: 22
	},
	{
		bits: "0000100",
		run: 23
	},
	{
		bits: "0101000",
		run: 24
	},
	{
		bits: "0101011",
		run: 25
	},
	{
		bits: "0010011",
		run: 26
	},
	{
		bits: "0100100",
		run: 27
	},
	{
		bits: "0011000",
		run: 28
	},
	{
		bits: "00000010",
		run: 29
	},
	{
		bits: "00000011",
		run: 30
	},
	{
		bits: "00011010",
		run: 31
	},
	{
		bits: "00011011",
		run: 32
	},
	{
		bits: "00010010",
		run: 33
	},
	{
		bits: "00010011",
		run: 34
	},
	{
		bits: "00010100",
		run: 35
	},
	{
		bits: "00010101",
		run: 36
	},
	{
		bits: "00010110",
		run: 37
	},
	{
		bits: "00010111",
		run: 38
	},
	{
		bits: "00101000",
		run: 39
	},
	{
		bits: "00101001",
		run: 40
	},
	{
		bits: "00101010",
		run: 41
	},
	{
		bits: "00101011",
		run: 42
	},
	{
		bits: "00101100",
		run: 43
	},
	{
		bits: "00101101",
		run: 44
	},
	{
		bits: "00000100",
		run: 45
	},
	{
		bits: "00000101",
		run: 46
	},
	{
		bits: "00001010",
		run: 47
	},
	{
		bits: "00001011",
		run: 48
	},
	{
		bits: "01010010",
		run: 49
	},
	{
		bits: "01010011",
		run: 50
	},
	{
		bits: "01010100",
		run: 51
	},
	{
		bits: "01010101",
		run: 52
	},
	{
		bits: "00100100",
		run: 53
	},
	{
		bits: "00100101",
		run: 54
	},
	{
		bits: "01011000",
		run: 55
	},
	{
		bits: "01011001",
		run: 56
	},
	{
		bits: "01011010",
		run: 57
	},
	{
		bits: "01011011",
		run: 58
	},
	{
		bits: "01001010",
		run: 59
	},
	{
		bits: "01001011",
		run: 60
	},
	{
		bits: "00110010",
		run: 61
	},
	{
		bits: "00110011",
		run: 62
	},
	{
		bits: "00110100",
		run: 63
	},
	{
		bits: "11011",
		run: 64
	},
	{
		bits: "10010",
		run: 128
	},
	{
		bits: "010111",
		run: 192
	},
	{
		bits: "0110111",
		run: 256
	},
	{
		bits: "00110110",
		run: 320
	},
	{
		bits: "00110111",
		run: 384
	},
	{
		bits: "01100100",
		run: 448
	},
	{
		bits: "01100101",
		run: 512
	},
	{
		bits: "01101000",
		run: 576
	},
	{
		bits: "01100111",
		run: 640
	},
	{
		bits: "011001100",
		run: 704
	},
	{
		bits: "011001101",
		run: 768
	},
	{
		bits: "011010010",
		run: 832
	},
	{
		bits: "011010011",
		run: 896
	},
	{
		bits: "011010100",
		run: 960
	},
	{
		bits: "011010101",
		run: 1024
	},
	{
		bits: "011010110",
		run: 1088
	},
	{
		bits: "011010111",
		run: 1152
	},
	{
		bits: "011011000",
		run: 1216
	},
	{
		bits: "011011001",
		run: 1280
	},
	{
		bits: "011011010",
		run: 1344
	},
	{
		bits: "011011011",
		run: 1408
	},
	{
		bits: "010011000",
		run: 1472
	},
	{
		bits: "010011001",
		run: 1536
	},
	{
		bits: "010011010",
		run: 1600
	},
	{
		bits: "011000",
		run: 1664
	},
	{
		bits: "010011011",
		run: 1728
	}
]);
const BLACK_TERMINATING_AND_MAKEUP = toRunCodeTuples([
	{
		bits: "0000110111",
		run: 0
	},
	{
		bits: "010",
		run: 1
	},
	{
		bits: "11",
		run: 2
	},
	{
		bits: "10",
		run: 3
	},
	{
		bits: "011",
		run: 4
	},
	{
		bits: "0011",
		run: 5
	},
	{
		bits: "0010",
		run: 6
	},
	{
		bits: "00011",
		run: 7
	},
	{
		bits: "000101",
		run: 8
	},
	{
		bits: "000100",
		run: 9
	},
	{
		bits: "0000100",
		run: 10
	},
	{
		bits: "0000101",
		run: 11
	},
	{
		bits: "0000111",
		run: 12
	},
	{
		bits: "00000100",
		run: 13
	},
	{
		bits: "00000111",
		run: 14
	},
	{
		bits: "000011000",
		run: 15
	},
	{
		bits: "0000010111",
		run: 16
	},
	{
		bits: "0000011000",
		run: 17
	},
	{
		bits: "0000001000",
		run: 18
	},
	{
		bits: "00001100111",
		run: 19
	},
	{
		bits: "00001101000",
		run: 20
	},
	{
		bits: "00001101100",
		run: 21
	},
	{
		bits: "00000110111",
		run: 22
	},
	{
		bits: "00000101000",
		run: 23
	},
	{
		bits: "00000010111",
		run: 24
	},
	{
		bits: "00000011000",
		run: 25
	},
	{
		bits: "000011001010",
		run: 26
	},
	{
		bits: "000011001011",
		run: 27
	},
	{
		bits: "000011001100",
		run: 28
	},
	{
		bits: "000011001101",
		run: 29
	},
	{
		bits: "000001101000",
		run: 30
	},
	{
		bits: "000001101001",
		run: 31
	},
	{
		bits: "000001101010",
		run: 32
	},
	{
		bits: "000001101011",
		run: 33
	},
	{
		bits: "000011010010",
		run: 34
	},
	{
		bits: "000011010011",
		run: 35
	},
	{
		bits: "000011010100",
		run: 36
	},
	{
		bits: "000011010101",
		run: 37
	},
	{
		bits: "000011010110",
		run: 38
	},
	{
		bits: "000011010111",
		run: 39
	},
	{
		bits: "000001101100",
		run: 40
	},
	{
		bits: "000001101101",
		run: 41
	},
	{
		bits: "000011011010",
		run: 42
	},
	{
		bits: "000011011011",
		run: 43
	},
	{
		bits: "000001010100",
		run: 44
	},
	{
		bits: "000001010101",
		run: 45
	},
	{
		bits: "000001010110",
		run: 46
	},
	{
		bits: "000001010111",
		run: 47
	},
	{
		bits: "000001100100",
		run: 48
	},
	{
		bits: "000001100101",
		run: 49
	},
	{
		bits: "000001010010",
		run: 50
	},
	{
		bits: "000001010011",
		run: 51
	},
	{
		bits: "000000100100",
		run: 52
	},
	{
		bits: "000000110111",
		run: 53
	},
	{
		bits: "000000111000",
		run: 54
	},
	{
		bits: "000000100111",
		run: 55
	},
	{
		bits: "000000101000",
		run: 56
	},
	{
		bits: "000001011000",
		run: 57
	},
	{
		bits: "000001011001",
		run: 58
	},
	{
		bits: "000000101011",
		run: 59
	},
	{
		bits: "000000101100",
		run: 60
	},
	{
		bits: "000001011010",
		run: 61
	},
	{
		bits: "000001100110",
		run: 62
	},
	{
		bits: "000001100111",
		run: 63
	},
	{
		bits: "0000001111",
		run: 64
	},
	{
		bits: "000011001000",
		run: 128
	},
	{
		bits: "000011001001",
		run: 192
	},
	{
		bits: "000001011011",
		run: 256
	},
	{
		bits: "000000110011",
		run: 320
	},
	{
		bits: "000000110100",
		run: 384
	},
	{
		bits: "000000110101",
		run: 448
	},
	{
		bits: "0000001101100",
		run: 512
	},
	{
		bits: "0000001101101",
		run: 576
	},
	{
		bits: "0000001001010",
		run: 640
	},
	{
		bits: "0000001001011",
		run: 704
	},
	{
		bits: "0000001001100",
		run: 768
	},
	{
		bits: "0000001001101",
		run: 832
	},
	{
		bits: "0000001110010",
		run: 896
	},
	{
		bits: "0000001110011",
		run: 960
	},
	{
		bits: "0000001110100",
		run: 1024
	},
	{
		bits: "0000001110101",
		run: 1088
	},
	{
		bits: "0000001110110",
		run: 1152
	},
	{
		bits: "0000001110111",
		run: 1216
	},
	{
		bits: "0000001010010",
		run: 1280
	},
	{
		bits: "0000001010011",
		run: 1344
	},
	{
		bits: "0000001010100",
		run: 1408
	},
	{
		bits: "0000001010101",
		run: 1472
	},
	{
		bits: "0000001011010",
		run: 1536
	},
	{
		bits: "0000001011011",
		run: 1600
	},
	{
		bits: "0000001100100",
		run: 1664
	},
	{
		bits: "0000001100101",
		run: 1728
	}
]);
const EXTENDED_MAKEUP = toRunCodeTuples([
	{
		bits: "00000001000",
		run: 1792
	},
	{
		bits: "00000001100",
		run: 1856
	},
	{
		bits: "00000001101",
		run: 1920
	},
	{
		bits: "000000010010",
		run: 1984
	},
	{
		bits: "000000010011",
		run: 2048
	},
	{
		bits: "000000010100",
		run: 2112
	},
	{
		bits: "000000010101",
		run: 2176
	},
	{
		bits: "000000010110",
		run: 2240
	},
	{
		bits: "000000010111",
		run: 2304
	},
	{
		bits: "000000011100",
		run: 2368
	},
	{
		bits: "000000011101",
		run: 2432
	},
	{
		bits: "000000011110",
		run: 2496
	},
	{
		bits: "000000011111",
		run: 2560
	}
]);
const TERMINATING_RUN_LIMIT = 64;
const MAX_RUN_CODE_BITS = 14;
const MODE_CODES = [
	["1", {
		kind: "vertical",
		delta: 0
	}],
	["011", {
		kind: "vertical",
		delta: 1
	}],
	["010", {
		kind: "vertical",
		delta: -1
	}],
	["001", {
		kind: "horizontal",
		delta: 0
	}],
	["0001", {
		kind: "pass",
		delta: 0
	}],
	["000011", {
		kind: "vertical",
		delta: 2
	}],
	["000010", {
		kind: "vertical",
		delta: -2
	}],
	["0000011", {
		kind: "vertical",
		delta: 3
	}],
	["0000010", {
		kind: "vertical",
		delta: -3
	}],
	["0000001", {
		kind: "extension",
		delta: 0
	}]
];
const MAX_MODE_CODE_BITS = 7;
const EOL_MIN_ZEROS = 11;
const MAX_FILL_ZERO_BITS = 512;
const CODE_KEY_VALUE_BITS = 16;
function codeKey(bitLength, code) {
	return bitLength * 2 ** CODE_KEY_VALUE_BITS + code;
}
function buildCodeTable(...groups) {
	const table = /* @__PURE__ */ new Map();
	for (const group of groups) for (const [bits, run] of group) table.set(codeKey(bits.length, Number.parseInt(bits, 2)), run);
	return table;
}
const WHITE_CODE_TABLE = buildCodeTable(WHITE_TERMINATING_AND_MAKEUP, EXTENDED_MAKEUP);
const BLACK_CODE_TABLE = buildCodeTable(BLACK_TERMINATING_AND_MAKEUP, EXTENDED_MAKEUP);
const MODE_CODE_TABLE = new Map(MODE_CODES.map(([bits, mode]) => [codeKey(bits.length, Number.parseInt(bits, 2)), mode]));
const BITS_PER_BYTE = 8;
const BYTE_INDEX_SHIFT = 3;
const MSB_BIT_MASK = 128;
const BYTE_MASK = 255;
var CcittBitReader = class {
	data;
	position = 0;
	constructor(data) {
		this.data = data;
	}
	get bitPosition() {
		return this.position;
	}
	set bitPosition(value) {
		this.position = value;
	}
	get exhausted() {
		return this.position >= this.data.length * BITS_PER_BYTE;
	}
	readBit() {
		if (this.exhausted) return -1;
		const bit = (this.data[this.position >> BYTE_INDEX_SHIFT] ?? 0) >> 7 - (this.position & 7) & 1;
		this.position++;
		return bit;
	}
	alignToByte() {
		this.position = Math.ceil(this.position / BITS_PER_BYTE) * BITS_PER_BYTE;
	}
	get atZeroPadding() {
		const remaining = this.data.length * BITS_PER_BYTE - this.position;
		if (remaining <= 0) return true;
		if (remaining >= BITS_PER_BYTE) return false;
		return ((this.data[this.data.length - 1] ?? 0) & (1 << remaining) - 1) === 0;
	}
};
function readSingleRunCode(reader, table) {
	let code = 0;
	for (let bitLength = 1; bitLength <= MAX_RUN_CODE_BITS; bitLength++) {
		const bit = reader.readBit();
		if (bit < 0) return;
		code = code << 1 | bit;
		const run = table.get(codeKey(bitLength, code));
		if (run !== void 0) return run;
	}
}
function readRunLength(reader, black) {
	const table = black ? BLACK_CODE_TABLE : WHITE_CODE_TABLE;
	let total = 0;
	for (;;) {
		const run = readSingleRunCode(reader, table);
		if (run === void 0) return;
		total += run;
		if (run < TERMINATING_RUN_LIMIT) return total;
	}
}
function readModeCode(reader) {
	let code = 0;
	for (let bitLength = 1; bitLength <= MAX_MODE_CODE_BITS; bitLength++) {
		const bit = reader.readBit();
		if (bit < 0) return {
			kind: "invalid",
			delta: 0
		};
		code = code << 1 | bit;
		const mode = MODE_CODE_TABLE.get(codeKey(bitLength, code));
		if (mode !== void 0) return mode;
	}
	return code === 0 ? {
		kind: "eol-prefix",
		delta: 0
	} : {
		kind: "invalid",
		delta: 0
	};
}
function tryReadEol(reader) {
	const start = reader.bitPosition;
	let zeros = 0;
	for (;;) {
		const bit = reader.readBit();
		if (bit < 0) {
			reader.bitPosition = start;
			return false;
		}
		if (bit === 0) {
			zeros++;
			if (zeros > MAX_FILL_ZERO_BITS) {
				reader.bitPosition = start;
				return false;
			}
			continue;
		}
		if (zeros >= EOL_MIN_ZEROS) return true;
		reader.bitPosition = start;
		return false;
	}
}
function findB1Index(reference, a0, color) {
	let index = 0;
	while (index < reference.length && reference[index] <= a0) index++;
	if (index < reference.length && (index & 1) !== color) index++;
	return index;
}
function elementAt(reference, index, columns) {
	return index < reference.length ? reference[index] : columns;
}
function decode1dRow(reader, columns) {
	const transitions = [];
	let position = 0;
	let black = false;
	while (position < columns) {
		const run = readRunLength(reader, black);
		if (run === void 0) return;
		position = Math.min(columns, position + run);
		transitions.push(position);
		black = !black;
	}
	return transitions;
}
function decode2dRow(reader, reference, columns) {
	const transitions = [];
	let a0 = -1;
	let color = 0;
	const maxTransitions = columns + 2;
	while (a0 < columns) {
		if (transitions.length > maxTransitions) return;
		const mode = readModeCode(reader);
		if (mode.kind === "invalid" || mode.kind === "extension") return;
		if (mode.kind === "eol-prefix") return;
		const b1Index = findB1Index(reference, a0, color);
		const b1 = elementAt(reference, b1Index, columns);
		const b2 = elementAt(reference, b1Index + 1, columns);
		if (mode.kind === "pass") {
			a0 = b2;
			continue;
		}
		if (mode.kind === "horizontal") {
			const start = a0 < 0 ? 0 : a0;
			const firstRun = readRunLength(reader, color === 1);
			if (firstRun === void 0) return;
			const secondRun = readRunLength(reader, color !== 1);
			if (secondRun === void 0) return;
			const a1 = Math.min(columns, start + firstRun);
			const a2 = Math.min(columns, a1 + secondRun);
			transitions.push(a1, a2);
			a0 = a2;
			continue;
		}
		const a1 = Math.min(columns, Math.max(0, b1 + mode.delta));
		transitions.push(a1);
		a0 = a1;
		color ^= 1;
	}
	return transitions;
}
function setBitRun(row, from, to, bit) {
	for (let x = from; x < to; x++) {
		const index = x >> BYTE_INDEX_SHIFT;
		const mask = MSB_BIT_MASK >> (x & 7);
		if (bit === 1) row[index] = (row[index] ?? 0) | mask;
		else row[index] = (row[index] ?? 0) & ~mask;
	}
}
function renderRow(transitions, columns, blackBit) {
	const row = new Uint8Array(Math.ceil(columns / BITS_PER_BYTE));
	if (blackBit === 0) row.fill(BYTE_MASK);
	let position = 0;
	let black = false;
	for (const transition of transitions) {
		const end = Math.min(transition, columns);
		if (black && end > position) setBitRun(row, position, end, blackBit);
		position = Math.max(position, end);
		black = !black;
	}
	return row;
}
const DEFAULT_COLUMNS = 1728;
function decodeCcittFax(data, options = {}) {
	const columns = options.columns ?? DEFAULT_COLUMNS;
	const requestedRows = options.rows ?? 0;
	const k = options.k ?? 0;
	const blackBit = options.blackIs1 === true ? 1 : 0;
	const encodedByteAlign = options.encodedByteAlign === true;
	const warn = options.onWarning;
	if (columns <= 0) return {
		bytes: /* @__PURE__ */ new Uint8Array(0),
		columns: 0,
		rows: 0
	};
	const reader = new CcittBitReader(data);
	const rows = [];
	let reference = [];
	let nextRowIs1d = k >= 0;
	while (requestedRows === 0 || rows.length < requestedRows) {
		if (encodedByteAlign) reader.alignToByte();
		if (tryReadEol(reader)) {
			if (k > 0) {
				const tag = reader.readBit();
				if (tag < 0) break;
				nextRowIs1d = tag === 1;
			}
			if (tryReadEol(reader)) break;
		}
		if (reader.atZeroPadding) break;
		const transitions = nextRowIs1d ? decode1dRow(reader, columns) : decode2dRow(reader, reference, columns);
		if (transitions === void 0) {
			if (warn !== void 0) warn(`CCITT fax data became undecodable at row ${String(rows.length)}; keeping the ${String(rows.length)} row(s) recovered so far`);
			break;
		}
		rows.push(renderRow(transitions, columns, blackBit));
		reference = transitions;
	}
	if (requestedRows > 0 && rows.length < requestedRows) {
		if (warn !== void 0 && rows.length > 0) warn(`CCITT fax data ended after ${String(rows.length)} of ${String(requestedRows)} declared rows; padding the remainder white`);
		const bytesPerRow = Math.ceil(columns / BITS_PER_BYTE);
		while (rows.length < requestedRows) {
			const blank = new Uint8Array(bytesPerRow);
			if (blackBit === 0) blank.fill(BYTE_MASK);
			rows.push(blank);
		}
	}
	return {
		bytes: concatBytes(rows),
		columns,
		rows: rows.length
	};
}
//#endregion
export { BLACK_TERMINATING_AND_MAKEUP, EXTENDED_MAKEUP, WHITE_TERMINATING_AND_MAKEUP, decodeCcittFax };
