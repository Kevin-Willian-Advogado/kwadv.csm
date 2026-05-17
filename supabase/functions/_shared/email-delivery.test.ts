import {
  formatSmtpDeliveryError,
  getFriendlySmtpErrorMessage,
} from './email-delivery.ts'

Deno.test('getFriendlySmtpErrorMessage explains Gmail rejected credentials', () => {
  const message = getFriendlySmtpErrorMessage(
    '535 5.7.8 Username and Password not accepted. For more information, go to gsmtp',
  )

  if (!message?.includes('senha de app')) {
    throw new Error(`Expected app-password guidance, got: ${message}`)
  }
})

Deno.test('getFriendlySmtpErrorMessage explains Gmail app password requirement', () => {
  const message = getFriendlySmtpErrorMessage(
    '534-5.7.9 Application-specific password required',
  )

  if (!message?.includes('senha de app')) {
    throw new Error(`Expected app-password guidance, got: ${message}`)
  }
})

Deno.test('formatSmtpDeliveryError keeps technical details for support', () => {
  const error = formatSmtpDeliveryError(new Error('535 5.7.8 Username and Password not accepted'))

  if (!error.includes('credenciais recusadas') || !error.includes('Detalhe tecnico')) {
    throw new Error(`Expected friendly and technical details, got: ${error}`)
  }
})
