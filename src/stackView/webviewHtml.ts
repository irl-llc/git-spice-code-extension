import * as vscode from 'vscode';

import { readMediaFile } from '../utils/readFileSync';

/** Generates a cryptographic nonce for CSP script security. */
export function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i += 1) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

/**
 * Renders the webview HTML content with proper CSP and resource URIs.
 *
 * @param webview - The webview to render for
 * @param extensionUri - The extension root URI for resolving resources
 * @returns The rendered HTML string
 */
export async function renderWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
	const nonce = getNonce();
	const csp = [
		`default-src 'none'`,
		`img-src ${webview.cspSource} https:`,
		`style-src ${webview.cspSource}`,
		`script-src 'nonce-${nonce}'`,
		`font-src ${webview.cspSource}`,
	].join('; ');

	const mediaUri = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', name)).toString();
	const distUri = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', name)).toString();
	const codiconStyleUri = distUri('codicons/codicon.css');
	const template = await readMediaFile(extensionUri, 'stackView.html');

	return template
		.replace('{{csp}}', csp)
		.replace('{{codiconStyleUri}}', codiconStyleUri)
		.replace('{{styleUri}}', mediaUri('stackView.css'))
		.replace('{{scriptUri}}', distUri('stackView.js'))
		.replace('{{nonce}}', nonce);
}
