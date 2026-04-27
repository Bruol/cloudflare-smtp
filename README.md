# cloudflare-smtp

Tiny SMTP client for Cloudflare Workers. It uses Cloudflare's `cloudflare:sockets` API and supports plain SMTP, implicit TLS, and STARTTLS.

## Install

```sh
bun add cloudflare-smtp
```

```sh
npm install cloudflare-smtp
```

You can also install directly from GitHub:

```sh
npm install github:Bruol/cloudflare-smtp
```

## Quick Start

```ts
import { sendMail } from 'cloudflare-smtp';

export default {
	async fetch() {
		await sendMail(
			{
				host: 'smtp.example.com',
				port: 465,
				username: 'smtp-user',
				password: 'smtp-password',
				from: 'Website <hello@example.com>',
				to: 'team@example.com'
			},
			{
				subject: 'Hello from a Worker',
				text: 'This email was sent through SMTP from Cloudflare Workers.'
			}
		);

		return new Response('sent');
	}
};
```

## Transport Modes

By default, `cloudflare-smtp` chooses the transport from the port:

- Port `465`: implicit TLS
- Port `587`: STARTTLS
- Any other port: plain SMTP

You can also set it explicitly:

```ts
await sendMail(
	{
		host: 'smtp.example.com',
		port: 587,
		secureTransport: 'starttls',
		username: env.SMTP_USER,
		password: env.SMTP_PASSWORD,
		from: 'hello@example.com',
		to: ['ops@example.com', 'support@example.com']
	},
	{
		subject: 'STARTTLS example',
		text: 'STARTTLS was negotiated before authentication.'
	}
);
```

```ts
await sendMail(
	{
		host: 'smtp.example.com',
		port: 465,
		secureTransport: 'tls',
		username: env.SMTP_USER,
		password: env.SMTP_PASSWORD,
		from: 'hello@example.com',
		to: 'ops@example.com'
	},
	{
		subject: 'TLS example',
		text: 'The socket connected with TLS from the start.'
	}
);
```

Available `secureTransport` values:

- `auto`: choose from the port number
- `tls`: implicit TLS, usually port `465`
- `starttls`: connect in STARTTLS mode and upgrade before authentication, usually port `587`
- `off`: plain SMTP

## API

### `sendMail(config, message)`

Sends one plain-text email.

`config`:

- `host`: SMTP hostname
- `port`: SMTP port, defaults to `465` for `tls` and `587` otherwise
- `username`: SMTP username
- `password`: SMTP password
- `from`: sender address
- `to`: one recipient or an array of recipients
- `secureTransport`: optional transport mode
- `heloName`: optional EHLO name, defaults to `cloudflare-smtp.local`
- `messageIdDomain`: optional domain for the generated `Message-ID`, defaults to `host`

`message`:

- `subject`: email subject
- `replyTo`: optional reply-to address
- `text`: plain text body

## Notes

This package is built for Cloudflare Workers and requires the `cloudflare:sockets` runtime module. It is not a Node.js SMTP client.

The current message builder sends plain-text email with UTF-8 headers and body content.
