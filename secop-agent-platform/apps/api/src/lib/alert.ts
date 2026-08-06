import axios from 'axios';

// Alerta externa por webhook HTTP (Slack/Teams/otros) configurada via ALERT_WEBHOOK_URL.
// Best-effort: un fallo al enviar nunca debe romper el flujo principal.
export async function sendAlert(message: string, details?: any): Promise<boolean> {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL || '';
  if (!webhookUrl) return false;

  try {
    await axios.post(
      webhookUrl,
      {
        text: message,
        timestamp: new Date().toISOString(),
        ...(details ? { details } : {}),
      },
      { timeout: 10000 },
    );
    return true;
  } catch (err: any) {
    console.error('[ALERT] Fallo al enviar alerta webhook:', err?.message || err);
    return false;
  }
}
