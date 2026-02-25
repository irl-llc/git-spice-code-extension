/**
 * File row rendering utilities shared by commit and working copy renderers.
 */

/** Action button configuration for file rows. */
export type FileRowAction = {
	icon: string;
	title: string;
	onClick: () => void;
};

/**
 * Creates a file-change row element with icon, name, and folder path.
 * Does not include status badge or action buttons.
 */
export function createFileRow(path: string): HTMLDivElement {
	const row = document.createElement('div');
	row.className = 'file-change';
	appendFileIdentity(row, path);
	return row;
}

/** Appends file icon, name, and folder path to a row element. */
export function appendFileIdentity(row: HTMLElement, path: string): void {
	const icon = document.createElement('i');
	icon.className = 'file-icon codicon codicon-file';
	row.appendChild(icon);

	const { fileName, folderPath } = splitPath(path);

	const nameSpan = document.createElement('span');
	nameSpan.className = 'file-name';
	nameSpan.textContent = fileName;
	row.appendChild(nameSpan);

	const folderSpan = document.createElement('span');
	folderSpan.className = 'file-folder';
	folderSpan.textContent = folderPath;
	row.appendChild(folderSpan);
}

/** Splits a path into file name and folder path components. */
function splitPath(path: string): { fileName: string; folderPath: string } {
	const lastSlash = path.lastIndexOf('/');
	return {
		fileName: lastSlash >= 0 ? path.slice(lastSlash + 1) : path,
		folderPath: lastSlash >= 0 ? path.slice(0, lastSlash) : '',
	};
}

/** Appends a file status badge (e.g., M, A, D, U). */
export function appendFileStatus(row: HTMLElement, status: string): void {
	const span = document.createElement('span');
	span.className = `file-status status-${status.toLowerCase()}`;
	span.textContent = status;
	row.appendChild(span);
}

/** Creates an action button for file rows with icon and click handler. */
export function createFileActionButton(iconClass: string, title: string, onClick: () => void): HTMLButtonElement {
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = 'file-action-btn';
	btn.title = title;
	btn.innerHTML = `<i class="codicon ${iconClass}"></i>`;
	btn.addEventListener('click', (event: Event) => {
		event.stopPropagation();
		onClick();
	});
	return btn;
}
