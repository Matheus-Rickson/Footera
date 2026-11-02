export interface CountryTemplate {
  code: string;
  name: string;
  demonym: string;
  firstNames: string[];
  lastNames: string[];
  cities: string[];
  clubPatterns: string[]; // {c} = cidade
  leagues: Array<{ name: string; tier: number; teams: number; promotion: number; relegation: number; continental: number; foreignLimit: number | null }>;
  wageScale: number; // multiplicador econômico
}

export const COUNTRY_TEMPLATES: CountryTemplate[] = [
  {
    code: 'BRA', name: 'Brasil', demonym: 'Brasil', wageScale: 0.6,
    firstNames: ['Lucas','Mateus','Gabriel','Rafael','Thiago','Bruno','Caio','Diego','Felipe','Gustavo','Henrique','João','Leonardo','Murilo','Pedro','Renan','Vitor','Yuri','Davi','Igor','Otávio','Wesley','Everton','Matheus'],
    lastNames: ['Silva','Souza','Oliveira','Santos','Lima','Pereira','Costa','Rodrigues','Almeida','Nascimento','Carvalho','Araújo','Ribeiro','Barbosa','Moreira','Cardoso','Teixeira','Mendes','Ramos','Freitas','Duarte','Batista','Monteiro','Campos'],
    cities: ['Rio Claro','Vila Nova','Serra Azul','Porto Seguro Alto','Campo Largo','Monte Verde','Santa Aurora','Boa Esperança','Ilha Grande','Cabo Sereno','Rio Dourado','Praia Branca','Pedra Alta','Vale do Sol','Nova Aliança','São Tomé do Norte','Lagoa Funda','Barra Mansa Alta','Itaúna do Sul','Jardim das Palmas'],
    clubPatterns: ['{c} FC','Atlético {c}','{c} Esporte Clube','Sport {c}','União {c}','{c} Atlético Clube','Real {c}','Associação {c}'],
    leagues: [
      { name: 'Série A', tier: 1, teams: 20, promotion: 0, relegation: 4, continental: 7, foreignLimit: null },
      { name: 'Série B', tier: 2, teams: 20, promotion: 4, relegation: 4, continental: 0, foreignLimit: null },
    ],
  },
  {
    code: 'ENG', name: 'Inglaterra', demonym: 'Inglaterra', wageScale: 1.6,
    firstNames: ['Oliver','Harry','Jack','George','Charlie','Thomas','James','William','Henry','Alfie','Mason','Callum','Declan','Jordan','Kyle','Marcus','Reece','Tyler','Connor','Liam','Ryan','Sam','Ben','Joe'],
    lastNames: ['Smith','Jones','Taylor','Brown','Wilson','Evans','Walker','Wright','Robinson','Thompson','White','Hughes','Edwards','Green','Hall','Wood','Harris','Clarke','Turner','Cooper','Hill','Ward','Morris','Baker'],
    cities: ['Ashford','Brookfield','Carlow Heath','Dunmere','Eastbourne Vale','Fenwick','Gravesford','Hartley','Ironbridge','Kingsmoor','Lakeshire','Marlow Green','Northcastle','Oakhaven','Pemberton','Queensway','Ravenscar','Stonebridge','Thornbury','Westerham'],
    clubPatterns: ['{c} United','{c} City','{c} Town','{c} Rovers','{c} Athletic','{c} Wanderers','{c} Albion','{c} Rangers'],
    leagues: [
      { name: 'Premier Division', tier: 1, teams: 20, promotion: 0, relegation: 3, continental: 7, foreignLimit: null },
      { name: 'Championship Division', tier: 2, teams: 20, promotion: 3, relegation: 3, continental: 0, foreignLimit: null },
    ],
  },
];

export const STADIUM_SUFFIX = ['Arena','Estádio Municipal','Park','Stadium','Parque','Estádio Central'];
