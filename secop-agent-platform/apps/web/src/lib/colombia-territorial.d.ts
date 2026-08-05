declare module "colombia-territorial" {
  interface Departamento {
    nombre: string;
    codigo_dane: string;
    capital: string;
    municipios: Municipio[];
  }

  interface Municipio {
    nombre: string;
    codigo_dane: string;
  }

  export function getDepartamentos(): Departamento[];
  export function getDepartamento(nombre: string): Departamento | undefined;
  export function getDepartamentoPorCodigo(codigo: string): Departamento | undefined;
  export function getMunicipios(departamento: string): Municipio[];
  export function getCapital(departamento: string): string;
  export function buscarDepartamento(query: string): Departamento[];
  export function todosLosMunicipios(): Municipio[];
  export function buscarMunicipioPorCodigo(codigo: string): Municipio | undefined;
}
