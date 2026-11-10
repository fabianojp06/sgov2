// Data e hora do alerta de tentativas de acesso (US-027, REQ0040): pt-BR, no fuso de São Paulo,
// como o modelo usuario.alerta_tentativas espera (o e-mail não converte fuso).
const DATA_HORA = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
export const formatarDataHoraAlerta = (d: Date): string => DATA_HORA.format(d);
