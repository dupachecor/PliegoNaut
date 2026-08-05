import { getDepartamentos, getMunicipios as getMunicipiosFromPackage } from "colombia-territorial";

export interface LocationGroup {
  department: string;
  municipios: string[];
}

export const DEPARTAMENTOS: string[] = getDepartamentos().map((d) => d.nombre);

export function getMunicipios(departamento: string): string[] {
  return getMunicipiosFromPackage(departamento).map((m) => m.nombre);
}

export const LOCATION_GROUPS: LocationGroup[] = DEPARTAMENTOS.map((d) => ({
  department: d,
  municipios: getMunicipios(d),
}));
