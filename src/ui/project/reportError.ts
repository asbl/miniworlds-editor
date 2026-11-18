import { t } from '../../i18n'
import { infoDialog } from '../dialogs'

/** Show an error in a dialog (file operations, restore, ...). */
export const reportError = (error: unknown) => infoDialog(t('dialog.error'), error instanceof Error ? error.message : String(error))
