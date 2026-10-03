import Swal from 'sweetalert2';

export interface ConfirmDialogOptions {
  title: string;
  text?: string;
  confirmText?: string;
  cancelText?: string;
  /** Destructive actions get the red confirm button and a warning icon. */
  danger?: boolean;
}

/** SweetAlert replacement for window.confirm(). Resolves true only when the user confirms. */
export async function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  const result = await Swal.fire({
    title: options.title,
    text: options.text,
    icon: options.danger ? 'warning' : 'question',
    showCancelButton: true,
    confirmButtonText: options.confirmText ?? 'Yes',
    cancelButtonText: options.cancelText ?? 'Cancel',
    confirmButtonColor: options.danger ? '#b34f35' : '#1f6b55',
    cancelButtonColor: '#66746c',
    reverseButtons: true,
    focusCancel: true,
  });
  return result.isConfirmed;
}
