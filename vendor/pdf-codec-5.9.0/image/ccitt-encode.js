import { BLACK_TERMINATING_AND_MAKEUP, EXTENDED_MAKEUP, WHITE_TERMINATING_AND_MAKEUP } from "./ccitt.js";
//#region src/image/ccitt-encode.ts
function buildRunCodes(table) {
	const map = /* @__PURE__ */ new Map();
	for (const [bits, run] of table) map.set(run, bits);
	for (const [bits, run] of EXTENDED_MAKEUP) if (!map.has(run)) map.set(run, bits);
	return map;
}
const WHITE_RUN_CODES = buildRunCodes(WHITE_TERMINATING_AND_MAKEUP);
const BLACK_RUN_CODES = buildRunCodes(BLACK_TERMINATING_AND_MAKEUP);
const PASS_MODE = "0001";
const HORIZONTAL_MODE = "001";
const VERTICAL_MODES = /* @__PURE__ */ new Map([
	[0, "1"],
	[1, "011"],
	[-1, "010"],
	[2, "000011"],
	[-2, "000010"],
	[3, "0000011"],
	[-3, "0000010"]
]);
const LARGEST_MAKEUP_RUN = 2560;
const MAKEUP_GRANULARITY = 64;
const BITS_PER_BYTE = 8;
const BYTE_INDEX_SHIFT = 3;
const BYTE_BIT_MASK = 7;
var BitWriter = class {
	bytes = [];
	current = 0;
	used = 0;
	get byteLength() {
		return this.bytes.length;
	}
	writeBits(bits) {
		for (const char of bits) {
			this.current = this.current << 1 | (char === "1" ? 1 : 0);
			this.used++;
			if (this.used === BITS_PER_BYTE) {
				this.bytes.push(this.current);
				this.current = 0;
				this.used = 0;
			}
		}
	}
	finish() {
		if (this.used > 0) this.bytes.push(this.current << BITS_PER_BYTE - this.used);
		return new Uint8Array(this.bytes);
	}
};
function writeRun(writer, run, white) {
	const codes = white ? WHITE_RUN_CODES : BLACK_RUN_CODES;
	let remaining = run;
	while (remaining >= MAKEUP_GRANULARITY) {
		const makeup = Math.min(remaining - remaining % MAKEUP_GRANULARITY, LARGEST_MAKEUP_RUN);
		writer.writeBits(codes.get(makeup));
		remaining -= makeup;
	}
	writer.writeBits(codes.get(remaining));
}
function changingElements(bitmap, rowByteOffset, columns) {
	const changes = [];
	let previous = 1;
	for (let x = 0; x < columns; x++) {
		const pixel = (bitmap[rowByteOffset + (x >> BYTE_INDEX_SHIFT)] ?? 0) >> BYTE_BIT_MASK - (x & BYTE_BIT_MASK) & 1;
		if (pixel !== previous) {
			changes.push(x);
			previous = pixel;
		}
	}
	return changes;
}
function encodeCcittFax(bitmap, options) {
	const { columns, rows, maxBytes } = options;
	if (columns <= 0 || rows <= 0) return /* @__PURE__ */ new Uint8Array(0);
	const rowBytes = columns + BYTE_BIT_MASK >> BYTE_INDEX_SHIFT;
	const writer = new BitWriter();
	let reference = [];
	for (let y = 0; y < rows; y++) {
		const offset = y * rowBytes;
		const current = changingElements(bitmap, offset, columns);
		let ci = 0;
		let ri = 0;
		const cur = (i) => current[i] ?? columns;
		const ref = (i) => reference[i] ?? columns;
		let a0 = -1;
		let white = true;
		while (a0 < columns) {
			if (maxBytes !== void 0 && writer.byteLength > maxBytes) return;
			const a1 = cur(ci);
			const a2 = cur(ci + 1);
			while (ri < reference.length && ref(ri) <= a0) ri++;
			let b1Index = ri;
			if (b1Index % 2 !== (white ? 0 : 1)) b1Index++;
			const b1 = ref(b1Index);
			const b2 = ref(b1Index + 1);
			if (b2 < a1) {
				writer.writeBits(PASS_MODE);
				a0 = b2;
			} else {
				const delta = a1 - b1;
				const vertical = VERTICAL_MODES.get(delta);
				if (vertical !== void 0) {
					writer.writeBits(vertical);
					a0 = a1;
					ci++;
				} else {
					writer.writeBits(HORIZONTAL_MODE);
					writeRun(writer, a1 - Math.max(a0, 0), white);
					writeRun(writer, a2 - a1, !white);
					a0 = a2;
					ci += 2;
				}
			}
			if (a0 < columns) white = ((bitmap[offset + (a0 >> BYTE_INDEX_SHIFT)] ?? 0) >> BYTE_BIT_MASK - (a0 & BYTE_BIT_MASK) & 1) === 1;
		}
		reference = current;
	}
	return writer.finish();
}
//#endregion
export { encodeCcittFax };
