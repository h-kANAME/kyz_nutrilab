/** Traduce/normaliza errores técnicos o de API a mensajes de usuario. */
export function translateAiError(raw: string): { title: string; body: string; hint?: string } {
  const msg = (raw || '').trim();
  const lower = msg.toLowerCase();

  if (!msg || lower === 'bad gateway' || lower === 'internal server error') {
    return {
      title: 'No se pudo estimar la comida',
      body: 'El asistente no respondió correctamente. Probá de nuevo en unos segundos.',
      hint: 'Si sigue fallando, cambiá el proveedor LLM en Ajustes.',
    };
  }

  if (/cuota|quota|429|rate.?limit|agotad/i.test(msg)) {
    return {
      title: 'Cuota del asistente agotada',
      body: 'El proveedor de inteligencia artificial alcanzó su límite de uso por ahora.',
      hint: 'Andá a Ajustes → Asistente AI y elegí otro LLM (por ejemplo OpenAI o DeepSeek), o esperá un rato e intentá de nuevo.',
    };
  }

  if (/api key|inválida|invalid|401|403|sin permiso|no configurada/i.test(msg)) {
    return {
      title: 'Problema con la API key',
      body: 'El proveedor elegido no tiene una clave válida o no está configurada en el servidor.',
      hint: 'Revisá las keys en el entorno del servidor o cambiá de proveedor en Ajustes.',
    };
  }

  if (/visión|vision|foto|imagen/i.test(msg) && /no soporta|not support/i.test(msg)) {
    return {
      title: 'Este LLM no analiza fotos',
      body: 'El proveedor actual solo entiende texto.',
      hint: 'Quitá la foto y describí la comida, o cambiá a Gemini u OpenAI en Ajustes.',
    };
  }

  if (/formato inesperado|no devolvió|empty|json/i.test(msg)) {
    return {
      title: 'Respuesta confusa del modelo',
      body: 'El asistente no pudo interpretar bien tu descripción.',
      hint: 'Reintentá con más detalle (cantidades y alimentos) o probá otro LLM.',
    };
  }

  if (/escribí la comida|subí una foto/i.test(msg)) {
    return {
      title: 'Falta información',
      body: 'Escribí qué comiste o subí una foto de la porción para continuar.',
    };
  }

  return {
    title: 'No se pudo registrar con AI',
    body: msg,
    hint: 'Podés reintentar o cambiar el LLM en Ajustes.',
  };
}
