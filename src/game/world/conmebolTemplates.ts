import type { CountryTemplate } from './names.ts';

/**
 * Países da CONMEBOL acrescentados na base 1.2.0 (docs/CONTINENTAIS.md, decisão do usuário em 08/11/2026): países **simplificados**
 * (1ª divisão com resultado rápido, sem acesso nem rebaixamento), para completar as vagas da Libertadores e da Sul-Americana.
 * Clubes e cidades fictícios, como o resto da base; o tamanho da 1ª divisão é o real de 2026 (Wikipédia e Teleamazonas, 25/09/2026).
 * `continental` = vagas na Libertadores (manual de clubes 2026, item 3.6.1). Ficam fora de COUNTRY_TEMPLATES de propósito: o gerador de
 * mundos dos testes e as listas de candidatos (olheiros, comissão) das carreiras existentes não mudam.
 */
export const CONMEBOL_TEMPLATES: CountryTemplate[] = [
  {
    code: 'URU', name: 'Uruguai', demonym: 'Uruguai', wageScale: 0.35, strength: -12,
    firstNames: ['Agustín','Facundo','Nicolás','Federico','Rodrigo','Diego','Matías','Sebastián','Martín','Gastón','Brian','Maximiliano','Emiliano','Santiago','Joaquín','Franco','Ignacio','Lucas','Bruno','Mauricio','Sergio','Álvaro','Gonzalo','Cristian'],
    lastNames: ['Rodríguez','González','Fernández','Pérez','Silva','Suárez','Martínez','López','Sosa','Pereira','Cabrera','Núñez','Méndez','Olivera','Acosta','Viera','Píriz','Correa','Techera','Castro','Ferreira','De los Santos','Bentancur','Araújo'],
    cities: ['Puerto Celeste','Villa Rambla','San Faustino','Colonia del Arroyo','Paso de las Toscas','Barrio Prado Norte','Cerro Albo','Las Piedras Altas','Santa Rosa del Plata','Villa Artigas','Punta Carreta Sur','Tres Cruces Viejo','Minas de Oro','Juan Lacaze Norte','Florida Alta','Rocha Vieja'],
    clubPatterns: ['Club Atlético {c}','Club Nacional de {c}','Deportivo {c}','Sportivo {c}','Racing Club de {c}','Defensor {c}','Liverpool de {c}','Wanderers de {c}'],
    stadiumNames: ['Estadio','Parque','Estadio Municipal','Gran Parque'],
    leagues: [{ name: 'Primera División', tier: 1, teams: 16, promotion: 0, relegation: 0, continental: 4, foreignLimit: null }],
  },
  {
    code: 'COL', name: 'Colômbia', demonym: 'Colômbia', wageScale: 0.35, strength: -12,
    firstNames: ['Juan','Andrés','Carlos','Luis','Jhon','Jefferson','Duván','Yerry','Wílmar','Sebastián','Daniel','Camilo','Mateus','Kevin','Brayan','Dayro','Edwin','Fredy','Harold','Jorman','Oscar','Teófilo','Yairo','Cristian'],
    lastNames: ['Rodríguez','Gómez','González','Martínez','López','Hernández','Díaz','Moreno','Ramírez','Valencia','Castaño','Cuadrado','Mina','Ospina','Zapata','Borja','Arias','Quintero','Muriel','Carrascal','Lerma','Sánchez','Palacios','Murillo'],
    cities: ['Villa del Cauca','San Gil Alto','Puerto Magdalena','Santa Marta Nueva','Ríonegro del Sur','Altos de Sabana','Valle de Tenza','Ciudad Bolívar Norte','Llano Grande','Bahía Solano Sur','Cerro de Oro','Pereira Vieja','Tunja Alta','Neiva del Río','Santa Rosa de Osos','La Dorada Baja','Montería Nueva','Girardot Alto','Ibagué del Norte','San Jacinto'],
    clubPatterns: ['Atlético {c}','Deportivo {c}','Independiente {c}','Club {c}','Real {c}','América de {c}','Unión {c}','Cortuluá {c}'],
    stadiumNames: ['Estadio','Estadio Municipal','Estadio Metropolitano','Coliseo'],
    leagues: [{ name: 'Primera A', tier: 1, teams: 20, promotion: 0, relegation: 0, continental: 4, foreignLimit: null }],
  },
  {
    code: 'ECU', name: 'Equador', demonym: 'Equador', wageScale: 0.35, strength: -14,
    firstNames: ['Moisés','Piero','Enner','Gonzalo','Ángel','Byron','Jhegson','Kendry','Pervis','Willian','Félix','Alan','Joao','Jordy','Kevin','Luis','Michael','Nilson','Ronald','Segundo','Xavier','Jeremy','José','Carlos'],
    lastNames: ['Caicedo','Estupiñán','Hincapié','Valencia','Plata','Preciado','Torres','Méndez','Arboleda','Mena','Cifuentes','Porozo','Ibarra','Rodríguez','Sornoza','Angulo','Quiñónez','Paredes','Castillo','Cortez','Mosquera','Bustos','Franco','Palacios'],
    cities: ['Puerto Manabí','San Gabriel del Mar','Valle de los Chillos','Santa Elena Alta','Ambato Nuevo','Cuenca del Río','Loja Vieja','Machala Sur','Riobamba Alta','Quevedo del Norte','Ibarra de los Lagos','Manta Nueva','Portoviejo Alto','Latacunga Sur','Esmeraldas Viejo','Guaranda Alta'],
    clubPatterns: ['Club {c}','Deportivo {c}','Liga de {c}','Independiente {c}','Universidad Católica de {c}','Sociedad Deportiva {c}','Técnico {c}','Atlético {c}'],
    stadiumNames: ['Estadio','Estadio Olímpico','Estadio Municipal','Estadio Reina'],
    leagues: [{ name: 'Serie A', tier: 1, teams: 16, promotion: 0, relegation: 0, continental: 4, foreignLimit: null }],
  },
  {
    code: 'PAR', name: 'Paraguai', demonym: 'Paraguai', wageScale: 0.3, strength: -14,
    firstNames: ['Miguel','Julio','Ángel','Gustavo','Junior','Derlis','Óscar','Richard','Mathías','Ramón','Antonio','Alejandro','Diego','Fabián','Hugo','Iván','Jorge','Luis','Marcos','Nelson','Roque','Gastón','Robert','Blas'],
    lastNames: ['Benítez','González','Giménez','Ortiz','Villalba','Martínez','Báez','Cáceres','Duarte','Rojas','Almirón','Gamarra','Enciso','Alderete','Sanabria','Romero','Cardozo','Riveros','Vera','Acosta','Aquino','Galeano','Ayala','Fretes'],
    cities: ['Villa Mbocayá','San Lorenzo del Este','Puerto Itá','Luque Nuevo','Capiatá Alto','Ciudad del Lago','Encarnación Vieja','Villarrica del Sur','Concepción Alta','Pilar del Río','Caacupé Nueva','Itauguá del Norte'],
    clubPatterns: ['Club {c}','Sportivo {c}','Deportivo {c}','General {c}','Club Atlético {c}','Sol de {c}'],
    stadiumNames: ['Estadio','Estadio Municipal','Estadio Defensores'],
    leagues: [{ name: 'División de Honor', tier: 1, teams: 12, promotion: 0, relegation: 0, continental: 4, foreignLimit: null }],
  },
  {
    code: 'CHI', name: 'Chile', demonym: 'Chile', wageScale: 0.4, strength: -16,
    firstNames: ['Alexis','Arturo','Charles','Gary','Mauricio','Eduardo','Claudio','Marcelo','Felipe','Diego','Ben','Darío','Erick','Guillermo','Jean','Marcos','Matías','Nicolás','Pablo','Rodrigo','Víctor','Javier','Alfonso','Esteban'],
    lastNames: ['Sánchez','Vidal','Aránguiz','Medel','Isla','Bravo','Valdivia','Vargas','Pulgar','Díaz','Muñoz','Rojas','González','Soto','Contreras','Silva','Morales','Fuentes','Castillo','Espinoza','Pizarro','Núñez','Cornejo','Alarcón'],
    cities: ['Puerto Aysén Norte','San Felipe del Valle','Villa Alemana Alta','Quillota Vieja','La Serena Sur','Rancagua del Río','Talca Nueva','Chillán Alto','Osorno del Lago','Iquique del Norte','Calama Vieja','Curicó Sur','Copiapó Alto','Linares del Valle','Temuco Nuevo','Valdivia del Mar'],
    clubPatterns: ['Club Deportivo {c}','Deportes {c}','Unión {c}','{c} Wanderers','Club {c}','Universidad de {c}','Everton de {c}','Audax {c}'],
    stadiumNames: ['Estadio','Estadio Municipal','Estadio Regional','Estadio El Teniente'],
    leagues: [{ name: 'Primera División', tier: 1, teams: 16, promotion: 0, relegation: 0, continental: 4, foreignLimit: null }],
  },
  {
    code: 'PER', name: 'Peru', demonym: 'Peru', wageScale: 0.3, strength: -18,
    firstNames: ['Paolo','Christian','Renato','Yoshimar','André','Edison','Gianluca','Luis','Pedro','Raziel','Sergio','Aldo','Bryan','Carlos','Jesús','Jhilmar','Kevin','Miguel','Oliver','Piero','Rodrigo','Wilder','Hernán','Alexander'],
    lastNames: ['Guerrero','Cueva','Tapia','Yotún','Carrillo','Flores','Lapadula','Advíncula','Gallese','Callens','Ramos','Polo','Zambrano','Peña','Reyna','Quispe','Huamán','Mamani','Chávez','Vásquez','Castro','Sánchez','Ruidíaz','Cartagena'],
    cities: ['Villa El Salvador Alto','San Martín de Porres Sur','Puerto Callao Viejo','Trujillo Nuevo','Arequipa del Misti','Cusco Imperial Alto','Piura del Norte','Chiclayo Viejo','Huancayo Alto','Tacna del Sur','Iquitos del Río','Ayacucho Nuevo','Cajamarca Alta','Juliaca Vieja','Pucallpa del Sur','Chimbote Alto','Ica Nueva','Huánuco del Valle'],
    clubPatterns: ['Club {c}','Deportivo {c}','Sport {c}','Alianza {c}','Universitario de {c}','Atlético {c}','Unión {c}','Sporting {c}'],
    stadiumNames: ['Estadio','Estadio Municipal','Estadio Nacional','Coliseo'],
    leagues: [{ name: 'Liga 1', tier: 1, teams: 18, promotion: 0, relegation: 0, continental: 4, foreignLimit: null }],
  },
  {
    code: 'BOL', name: 'Bolívia', demonym: 'Bolívia', wageScale: 0.2, strength: -22,
    firstNames: ['Marcelo','Juan Carlos','Ramiro','Henry','Diego','Leonel','Carlos','Erwin','Jaime','Luis','Miguel','Pablo','Roberto','Víctor','Boris','Danny','Fernando','Gabriel','José','Moisés','Óscar','Rodrigo','Samuel','Wálter'],
    lastNames: ['Moreno','Arce','Vaca','Justiniano','Saucedo','Vaca Díez','Cuéllar','Chumacero','Lampe','Bejarano','Fernández','Quiroga','Haquin','Villarroel','Álvarez','Mamani','Quispe','Gutiérrez','Rojas','Terceros','Algarañaz','Ribera','Ortiz','Suárez'],
    cities: ['Villa Montes Alto','San Ignacio de Moxos','Puerto Quijarro Sur','Cochabamba del Valle','Oruro Alto','Sucre Antiguo','Tarija del Sur','Potosí de la Plata','Trinidad del Beni','Cobija del Norte','Montero Nuevo','Yacuiba del Sur','Riberalta Alta','El Alto Viejo','Camiri del Chaco','Sacaba del Valle'],
    clubPatterns: ['Club {c}','Club Deportivo {c}','Real {c}','Always {c}','Universitario de {c}','Aurora {c}','Atlético {c}','Independiente {c}'],
    stadiumNames: ['Estadio','Estadio Municipal','Estadio Departamental','Coliseo'],
    leagues: [{ name: 'División Profesional', tier: 1, teams: 16, promotion: 0, relegation: 0, continental: 4, foreignLimit: null }],
  },
  {
    code: 'VEN', name: 'Venezuela', demonym: 'Venezuela', wageScale: 0.2, strength: -22,
    firstNames: ['Salomón','Tomás','Yangel','Josef','Darwin','Jefferson','Eduard','Jhon','Rómulo','Wuilker','Yeferson','Alexander','Cristian','Daniel','Ronald','José','Luis','Miguel','Nahuel','Óscar','Andrés','Carlos','Kervin','Telasco'],
    lastNames: ['Rondón','Rincón','Herrera','Martínez','Machís','Savarino','Bello','Chancellor','Otero','Faríñez','Soteldo','Ferraresi','Aramburu','Cádiz','Hurtado','Navarro','Osorio','Sosa','Rivas','Peña','Lucena','González','Romo','Segovia'],
    cities: ['Puerto Cabello Alto','San Cristóbal del Táchira','Ciudad Bolívar Vieja','Maracay Nueva','Barquisimeto del Este','Valencia del Lago','Mérida de los Andes','Maturín del Norte','Barinas Alta','Cumaná Vieja','Puerto Ordaz Sur','Acarigua del Llano','San Felipe Viejo','Guanare Alto'],
    clubPatterns: ['Deportivo {c}','Club {c}','Caracas {c}','Atlético {c}','Estudiantes de {c}','Academia {c}','Monagas {c}','Zamora {c}'],
    stadiumNames: ['Estadio','Estadio Olímpico','Polideportivo','Estadio Metropolitano'],
    leagues: [{ name: 'Primera División', tier: 1, teams: 14, promotion: 0, relegation: 0, continental: 4, foreignLimit: null }],
  },
];

/** Códigos dos países acrescentados na base 1.2.0. */
export const CONMEBOL_CODES: readonly string[] = CONMEBOL_TEMPLATES.map((t) => t.code);
