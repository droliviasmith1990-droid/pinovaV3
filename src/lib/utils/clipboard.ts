/**
 * Copy text to clipboard with fallback for non-secure contexts (HTTP).
 * navigator.clipboard.writeText() only works in secure contexts (HTTPS or localhost).
 * This utility falls back to the legacy execCommand('copy') approach when needed.
 */
export async function copyToClipboard(text: string): Promise<void> {
    // Try the modern Clipboard API first
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
    }

    // Fallback: use a hidden textarea + execCommand
    const textarea = document.createElement('textarea');
    textarea.value = text;

    // Avoid scrolling to bottom
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';

    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
        const success = document.execCommand('copy');
        if (!success) {
            throw new Error('execCommand copy failed');
        }
    } finally {
        document.body.removeChild(textarea);
    }
}
