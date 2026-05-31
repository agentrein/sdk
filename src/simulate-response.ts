export function createSimulatedResponse(propertyName?: string): unknown {
  return new Proxy({} as Record<string, unknown>, {
    get(_target, prop: string) {
      if (prop === 'simulated') return true;
      if (prop === 'then') return undefined; // prevent Promise confusion
      if (prop === 'toJSON') return () => ({ simulated: true });
      // Dynamic property responses based on prop name:
      if (prop === 'id' || prop.endsWith('_id') || prop.endsWith('Id'))
        return `sim_${prop}_${Date.now()}`;
      if (prop === 'url' || prop.endsWith('_url') || prop.endsWith('Url'))
        return 'https://sandbox.agentrein.com';
      if (prop === 'number') return 0;
      if (prop === 'status') return 'simulated';
      if (prop === 'created' || prop === 'createdAt') return new Date().toISOString();
      // Default: return nested simulated proxy for any other property
      return createSimulatedResponse(prop);
    }
  });
}
