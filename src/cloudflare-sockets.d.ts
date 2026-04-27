declare module 'cloudflare:sockets' {
	export interface Socket {
		readable: ReadableStream<Uint8Array>;
		writable: WritableStream<Uint8Array>;
		startTls(): Socket;
		close(): void;
	}

	export function connect(
		address: { hostname: string; port: number },
		options?: { secureTransport?: 'off' | 'on' | 'starttls' }
	): Socket;
}
