//#region src/bytes/writer.ts
var ByteWriter = class {
	chunks = [];
	byteLength = 0;
	get length() {
		return this.byteLength;
	}
	writeBytes(bytes) {
		if (bytes.length === 0) return;
		this.chunks.push(bytes);
		this.byteLength += bytes.length;
	}
	writeByte(byte) {
		this.writeBytes(new Uint8Array([byte]));
	}
	writeAscii(text) {
		this.writeBytes(new TextEncoder().encode(text));
	}
	toBytes() {
		const out = new Uint8Array(this.byteLength);
		let offset = 0;
		for (const chunk of this.chunks) {
			out.set(chunk, offset);
			offset += chunk.length;
		}
		return out;
	}
};
function concatBytes(chunks) {
	const writer = new ByteWriter();
	for (const chunk of chunks) writer.writeBytes(chunk);
	return writer.toBytes();
}
//#endregion
export { ByteWriter, concatBytes };
