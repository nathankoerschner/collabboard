interface ConfirmModalOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  confirmDanger?: boolean;
}

export function confirmModal(opts: ConfirmModalOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card">
        <div class="modal-title">${opts.title}</div>
        <div class="modal-message">${opts.message}</div>
        <div class="modal-actions">
          <button class="btn btn-secondary modal-cancel">Cancel</button>
          <button class="btn ${opts.confirmDanger ? 'btn-danger' : 'btn-primary'} modal-confirm">
            ${opts.confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    `;

    function close(result: boolean) {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(result);
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close(false);
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });
    overlay.querySelector('.modal-cancel')!.addEventListener('click', () => close(false));
    overlay.querySelector('.modal-confirm')!.addEventListener('click', () => close(true));
    document.addEventListener('keydown', onKey);

    document.body.appendChild(overlay);
    (overlay.querySelector('.modal-confirm') as HTMLElement).focus();
  });
}
