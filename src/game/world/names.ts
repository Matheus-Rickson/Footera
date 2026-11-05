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
  /** ajuste da reputação dos clubes do país (0 = Brasil/Inglaterra; negativo = futebol mais fraco) */
  strength?: number;
  /** prefixos de nome de estádio no idioma do país (padrão: STADIUM_SUFFIX) */
  stadiumNames?: string[];
}

export const COUNTRY_TEMPLATES: CountryTemplate[] = [
  {
    code: 'BRA', name: 'Brasil', demonym: 'Brasil', wageScale: 0.6,
    firstNames: ['Lucas','Mateus','Samuel','Rafael','Ruan','Bruno','Caio','Heitor','Felipe','Gustavo','Henrique','João','Leonardo','Murilo','Pedro','Renan','Vitor','Yuri','Davi','Igor','Otávio','Wesley','Douglas','Matheus'],
    lastNames: ['Silva','Souza','Oliveira','Santos','Lima','Pereira','Costa','Rodrigues','Almeida','Nascimento','Carvalho','Araújo','Ribeiro','Barbosa','Moreira','Cardoso','Teixeira','Mendes','Ramos','Freitas','Duarte','Batista','Monteiro','Campos'],
    cities: ['Rio Claro','Vila Nova','Serra Azul','Porto Seguro Alto','Campo Largo','Monte Verde','Santa Aurora','Boa Esperança','Ilha Grande','Cabo Sereno','Rio Dourado','Praia Branca','Pedra Alta','Vale do Sol','Nova Aliança','São Tomé do Norte','Lagoa Funda','Barra Mansa Alta','Itaúna do Sul','Jardim das Palmas'],
    clubPatterns: ['{c} FC','Atlético {c}','{c} Esporte Clube','Sport {c}','União {c}','{c} Atlético Clube','Real {c}','Associação {c}'],
    leagues: [
      { name: 'Série A', tier: 1, teams: 20, promotion: 0, relegation: 4, continental: 7, foreignLimit: null },
      { name: 'Série B', tier: 2, teams: 20, promotion: 4, relegation: 4, continental: 0, foreignLimit: null },
      { name: 'Série C', tier: 3, teams: 20, promotion: 4, relegation: 4, continental: 0, foreignLimit: null },
      { name: 'Série D', tier: 4, teams: 20, promotion: 4, relegation: 0, continental: 0, foreignLimit: null },
    ],
  },
  {
    code: 'ENG', name: 'Inglaterra', demonym: 'Inglaterra', wageScale: 1.6,
    firstNames: ['Oliver','Harry','Jack','George','Charlie','Thomas','James','William','Henry','Alfie','Mason','Callum','Declan','Jordan','Kieran','Marcus','Reece','Tyler','Connor','Liam','Ryan','Sam','Ellis','Joe'],
    lastNames: ['Smith','Jones','Taylor','Brown','Wilson','Evans','Walker','Wright','Robinson','Thompson','White','Hughes','Edwards','Green','Hall','Wood','Harris','Clarke','Turner','Cooper','Hill','Ward','Morris','Baker'],
    cities: ['Ashford','Brookfield','Carlow Heath','Dunmere','Eastbourne Vale','Fenwick','Gravesford','Hartley','Ironbridge','Kingsmoor','Lakeshire','Marlow Green','Northcastle','Oakhaven','Pemberton','Queensway','Ravenscar','Stonebridge','Thornbury','Westerham'],
    clubPatterns: ['{c} United','{c} City','{c} Town','{c} Rovers','{c} Athletic','{c} Wanderers','{c} Albion','{c} Rangers'],
    leagues: [
      { name: 'Premier Division', tier: 1, teams: 20, promotion: 0, relegation: 3, continental: 7, foreignLimit: null },
      { name: 'Championship Division', tier: 2, teams: 20, promotion: 3, relegation: 3, continental: 0, foreignLimit: null },
      { name: 'League One', tier: 3, teams: 20, promotion: 3, relegation: 4, continental: 0, foreignLimit: null },
      { name: 'League Two', tier: 4, teams: 20, promotion: 4, relegation: 0, continental: 0, foreignLimit: null },
    ],
  },
  {
    code: 'ESP', name: 'Espanha', demonym: 'Espanha', wageScale: 1.3, strength: 0,
    firstNames: ['Alejandro','Pablo','Javier','Sergio','Daniel','Adrián','Álvaro','Diego','Iker','Marcos','Rubén','Óscar','Mario','Fermín','Carlos','Jorge','Andrés','Iván','Víctor','Gonzalo','Unai','Aitor','Borja','Íñigo'],
    lastNames: ['García','Fernández','González','Rodríguez','López','Martínez','Sánchez','Pérez','Gómez','Martín','Jiménez','Ruiz','Hernández','Díaz','Moreno','Muñoz','Álvarez','Romero','Navarro','Torres','Domínguez','Gil','Vázquez','Serrano'],
    cities: ['Valdemora','Puerto Alto','Sierra Clara','Villanueva del Río','Castelmar','Monteluz','Santa Brisa','Aguasvivas','Robledal','Campoverde','Torrealba','Peñafría','Almenara','Riosol','Los Pinares','Vallehondo','San Lorián','Mirasierra','Costablanca Norte','Fuentecilla','Arenales','Olivares','Puente Real','Altamira del Mar','Cerro Dorado','La Vega Alta','Brañuelas','Calaforra','Montenegrillo','Valdeluna'],
    clubPatterns: ['{c} CF','Real {c}','Deportivo {c}','Atlético {c}','Unión Deportiva {c}','Racing {c}','Sporting {c}','CD {c}'],
    stadiumNames: ['Estadio','Campo Municipal','Nuevo Estadio','Estadio Municipal'],
    leagues: [
      { name: 'Primera División', tier: 1, teams: 20, promotion: 0, relegation: 3, continental: 6, foreignLimit: null },
      { name: 'Segunda División', tier: 2, teams: 20, promotion: 3, relegation: 4, continental: 0, foreignLimit: null },
      { name: 'Primera Federación', tier: 3, teams: 20, promotion: 4, relegation: 0, continental: 0, foreignLimit: null },
    ],
  },
  {
    code: 'GER', name: 'Alemanha', demonym: 'Alemanha', wageScale: 1.3, strength: -1,
    firstNames: ['Lukas','Leon','Jonas','Felix','Maximilian','Paul','Luca','Tim','Niklas','Jan','Florian','Moritz','Julian','Tobias','Kai','Marco','Sebastian','Dennis','Philipp','Fabian','Nico','Leroy','Henrik','Benedikt'],
    lastNames: ['Müller','Schmidt','Schneider','Fischer','Weber','Meyer','Wagner','Becker','Schulz','Hoffmann','Koch','Richter','Klein','Wolf','Schröder','Neumann','Braun','Zimmermann','Krüger','Hartmann','Lange','Werner','Krause','Vogel'],
    cities: ['Altenbrück','Bergheim am See','Dornfeld','Eichenstadt','Falkenau','Grünwalde','Hohenmark','Kaltenbach','Lindenhof','Mühlhausen-Ost','Neustein','Oberwiesen','Rabenfurt','Sonnenberg','Talheim','Wasserburg-Nord','Weißenau','Zellingen','Rosenthal','Steinkirchen','Hafenstadt','Birkenau','Lerchental','Kronach-West','Adlersfeld','Wolfsried','Buchenhain','Silberau','Reichenstein','Fichtenberg'],
    clubPatterns: ['FC {c}','SV {c}','VfB {c}','TSV {c}','{c} 04','Borussia {c}','SC {c}','Eintracht {c}'],
    stadiumNames: ['Stadion','Arena','Sportpark','Waldstadion'],
    leagues: [
      { name: 'Erste Liga', tier: 1, teams: 18, promotion: 0, relegation: 2, continental: 6, foreignLimit: null },
      { name: 'Zweite Liga', tier: 2, teams: 18, promotion: 2, relegation: 3, continental: 0, foreignLimit: null },
      { name: 'Dritte Liga', tier: 3, teams: 20, promotion: 3, relegation: 0, continental: 0, foreignLimit: null },
    ],
  },
  {
    code: 'ITA', name: 'Itália', demonym: 'Itália', wageScale: 1.2, strength: -2,
    firstNames: ['Lorenzo','Matteo','Alessandro','Leonardo','Francesco','Andrea','Gabriele','Riccardo','Davide','Federico','Marco','Luca','Simone','Giacomo','Nicolò','Stefano','Tommaso','Emanuele','Pietro','Daniele','Fabio','Alessio','Mattia','Giorgio'],
    lastNames: ['Rossi','Russo','Ferrari','Esposito','Bianchi','Romano','Colombo','Ricci','Marino','Greco','Bruno','Gallo','Conti','De Luca','Mancini','Costa','Giordano','Rizzo','Lombardi','Moretti','Barbieri','Fontana','Santoro','Caruso'],
    cities: ['Valdorso','Portoverde','Montealto','San Lucido','Castelrosso','Fiumara','Borgo Sereno','Rocca Bianca','Lagonero','Pietrasanta Alta','Villafiore','Campobello','Torre Marina','Sassoluna','Collealto','Acquaviva Nord','Monterosa','Ponte Antico','Selvadoro','Marenzo'],
    clubPatterns: ['{c} Calcio','AC {c}','US {c}','Sporting {c}','Virtus {c}','Atletico {c}','Real {c}','FC {c}'],
    stadiumNames: ['Stadio','Stadio Comunale','Arena','Stadio Civico'],
    leagues: [
      { name: 'Serie Uno', tier: 1, teams: 20, promotion: 0, relegation: 3, continental: 6, foreignLimit: null },
      { name: 'Serie Due', tier: 2, teams: 20, promotion: 3, relegation: 0, continental: 0, foreignLimit: null },
    ],
  },
  {
    code: 'FRA', name: 'França', demonym: 'França', wageScale: 1.1, strength: -4,
    firstNames: ['Lucas','Hugo','Théo','Nathan','Louis','Jules','Mathis','Enzo','Raphaël','Antoine','Maxime','Baptiste','Clément','Kylian','Adrien','Julien','Romain','Florian','Yanis','Quentin','Thomas','Benjamin','Bastien','Ousmane'],
    lastNames: ['Martin','Bernard','Dubois','Thomas','Robert','Richard','Petit','Durand','Leroy','Moreau','Simon','Laurent','Lefebvre','Michel','Garcia','David','Bertrand','Roux','Vincent','Fournier','Morel','Girard','André','Mercier'],
    cities: ['Beaumont-sur-Loire','Saint-Aubin-la-Mer','Villeclair','Montfleury','Rochebrune','Valmont','Chantebourg','Port-Lazare','Belcastel','Fontenay-le-Vieux','Serrières','Lumière-Ville','Mireval','Clairmont','Saint-Rémi-des-Prés','Hautecombe','Bellerive','Marsanne','Givray','Pontaven-Nord'],
    clubPatterns: ['{c} FC','Olympique {c}','AS {c}','Stade {c}','Racing {c}','SC {c}','US {c}','Girondins {c}'],
    stadiumNames: ['Stade','Stade Municipal','Parc des Sports','Stade du Parc'],
    leagues: [
      { name: 'Première Ligue', tier: 1, teams: 18, promotion: 0, relegation: 2, continental: 5, foreignLimit: null },
      { name: 'Deuxième Ligue', tier: 2, teams: 18, promotion: 2, relegation: 0, continental: 0, foreignLimit: null },
    ],
  },
  {
    code: 'POR', name: 'Portugal', demonym: 'Portugal', wageScale: 0.7, strength: -8,
    firstNames: ['João','Rodrigo','Tiago','Leandro','Gonçalo','Rúben','Lourenço','Henrique','Sérgio','Salvador','Rui','Miguel','Hugo','Francisco','Vítor','Telmo','Norberto','Rafael','Afonso','Duarte','Martim','Simão','Tomás','Gil'],
    lastNames: ['Silva','Santos','Ferreira','Pereira','Oliveira','Costa','Rodrigues','Martins','Jesus','Sousa','Fernandes','Gonçalves','Gomes','Lopes','Marques','Alves','Almeida','Ribeiro','Pinto','Carvalho','Teixeira','Moreira','Correia','Mendes'],
    cities: ['Vila Serena','Porto Alvo','Monte Claro','Santa Brígida','Ribeira Alta','Castelo Novo','Vale Formoso','Aldeia do Mar','Pedrógão Velho','Figueira da Serra','São Martinho do Rio','Torre de Moura','Lagoa Clara','Arcos do Norte','Penedo','Rio Maior Sul','Barcarena Alta','Alvorada','Mirandela Nova','Sobral do Monte'],
    clubPatterns: ['{c} FC','Sporting {c}','Vitória {c}','Académico {c}','União {c}','Desportivo {c}','Atlético {c}','Clube {c}'],
    stadiumNames: ['Estádio','Estádio Municipal','Estádio do Clube','Parque'],
    leagues: [
      { name: 'Primeira Liga', tier: 1, teams: 18, promotion: 0, relegation: 2, continental: 4, foreignLimit: null },
      { name: 'Segunda Liga', tier: 2, teams: 18, promotion: 2, relegation: 0, continental: 0, foreignLimit: null },
    ],
  },
  {
    code: 'NED', name: 'Holanda', demonym: 'Holanda', wageScale: 0.8, strength: -8,
    firstNames: ['Daan','Sem','Lucas','Milan','Levi','Luuk','Bram','Thijs','Jesse','Stijn','Ruben','Tim','Jasper','Wout','Joris','Floris','Matthijs','Kees','Niels','Teun','Ryan','Denzel','Jurriën','Steven'],
    lastNames: ['de Jong','Jansen','de Vries','van den Berg','van Dijk','Bakker','Janssen','Visser','Smit','Meijer','de Boer','Mulder','de Groot','Bos','Vos','Peters','Hendriks','van Leeuwen','Dekker','Brouwer','de Wit','Dijkstra','Smits','de Graaf'],
    cities: ['Zeewolde-Noord','Amstelveld','Dijkhoven','Molenburg','Waterland','Heidegraaf','Lindedal','Oosterhaven','Polderwijk','Rietveld','Sluisdam','Tulpendorp','Veenstad','Westerkwartier','Zandvoorde','Brugmeer','Kanaalzicht','Duinwijk','Havenburg','Grachtstad'],
    clubPatterns: ['{c} FC','SC {c}','Go Ahead {c}','Sparta {c}','VV {c}','Fortuna {c}','Willem {c}','Heracles {c}'],
    stadiumNames: ['Stadion','Park','Arena','Sportpark'],
    leagues: [
      { name: 'Eredivisie', tier: 1, teams: 18, promotion: 0, relegation: 2, continental: 4, foreignLimit: null },
      { name: 'Eerste Divisie', tier: 2, teams: 18, promotion: 2, relegation: 0, continental: 0, foreignLimit: null },
    ],
  },
  {
    code: 'ARG', name: 'Argentina', demonym: 'Argentina', wageScale: 0.4, strength: -8,
    firstNames: ['Santiago','Mateo','Thiago','Benjamín','Joaquín','Tomás','Ramiro','Facundo','Bautista','Agustín','Franco','Valentín','Gonzalo','Ignacio','Maximiliano','Rodrigo','Leandro','Ezequiel','Matías','Lisandro','Alexis','Exequiel','Nahuel','Gastón'],
    lastNames: ['González','Rodríguez','Gómez','Fernández','López','Díaz','Martínez','Pérez','García','Sánchez','Romero','Sosa','Álvarez','Torres','Ruiz','Ramírez','Flores','Acosta','Benítez','Medina','Herrera','Suárez','Aguirre','Giménez'],
    cities: ['Villa Sarmiento','Puerto Ventana','San Ramiro','Las Acacias','General Ordóñez','Ciudad Jardín Norte','Río Turbio Alto','Pampa Clara','Santa Lucía del Sur','Villa del Lago','Cañada Honda','Los Cardales','Monte Grande Sur','Bahía Serena','Colonia Esperanza','Tres Arroyos Viejo','Pueblo Nuevo','La Calera Alta','San Telmo del Río','Valle Hermoso'],
    clubPatterns: ['Club Atlético {c}','Deportivo {c}','Racing {c}','Sportivo {c}','Unión {c}','Independiente {c}','Ferro {c}','Estudiantes de {c}'],
    stadiumNames: ['Estadio','Estadio Municipal','Cancha','Estadio Monumental'],
    leagues: [
      { name: 'Liga Profesional', tier: 1, teams: 20, promotion: 0, relegation: 2, continental: 5, foreignLimit: null },
      { name: 'Primera Nacional', tier: 2, teams: 20, promotion: 2, relegation: 0, continental: 0, foreignLimit: null },
    ],
  },
  {
    code: 'BEL', name: 'Bélgica', demonym: 'Bélgica', wageScale: 0.7, strength: -12,
    firstNames: ['Lucas','Louis','Noah','Arthur','Jules','Victor','Liam','Adam','Mathis','Thibaut','Kevin','Eden','Romelu','Youri','Dries','Axel','Hans','Jelle','Wout','Siebe','Arne','Maxim','Leander','Charles'],
    lastNames: ['Peeters','Janssens','Maes','Jacobs','Mertens','Willems','Claes','Goossens','Wouters','De Smet','Dubois','Lambert','Dupont','Hermans','Michiels','Lemmens','Martens','Vermeulen','Desmet','Coppens','Van Damme','Pauwels','Leclercq','Renard'],
    cities: ['Brughem','Lierbeek','Mechelaar','Hasseldonk','Charleroy-Nord','Namurois','Kortrijkse','Ostvelde','Aalstede','Genkveld','Waregemmeer','Leuvenhoek','Montmédy','Spaarbeek','Tournaval','Diesthout'],
    clubPatterns: ['KV {c}','Club {c}','Standard {c}','Royal {c}','Sporting {c}','KRC {c}','Union {c}','Cercle {c}'],
    stadiumNames: ['Stadion','Stade','Arena'],
    leagues: [
      { name: 'Pro League', tier: 1, teams: 16, promotion: 0, relegation: 2, continental: 4, foreignLimit: null },
      { name: 'Challenger League', tier: 2, teams: 16, promotion: 2, relegation: 0, continental: 0, foreignLimit: null },
    ],
  },
  {
    code: 'JPN', name: 'Japão', demonym: 'Japão', wageScale: 0.8, strength: -16,
    firstNames: ['Haruto','Yuto','Sota','Riku','Kaito','Ren','Takumi','Daiki','Kenta','Shota','Yuki','Hiroki','Ryo','Takefusa','Kaoru','Ritsu','Wataru','Ko','Shunsuke','Daichi','Ayase','Kyogo','Hidemasa','Reo'],
    lastNames: ['Sato','Suzuki','Takahashi','Tanaka','Watanabe','Ito','Yamamoto','Nakamura','Kobayashi','Kato','Yoshida','Yamada','Sasaki','Yamaguchi','Matsumoto','Inoue','Kimura','Hayashi','Shimizu','Yamazaki','Mori','Ikeda','Hashimoto','Ishikawa'],
    cities: ['Higashimura','Kitahama','Minamioka','Nishizawa','Aokawa','Shirayama','Kurosaki','Midorigawa','Hanazono','Tsukimachi','Sakuragaoka','Umihara','Kazeno','Hoshida','Takamatsu-Kita','Yukimura','Akaishi','Momoyama','Isehara-Nishi','Kawagoe-Minami'],
    clubPatterns: ['{c} FC','{c} United','Vissel {c}','Sanfrecce {c}','{c} Reysol','{c} Frontale','Consadole {c}','{c} Antlers'],
    stadiumNames: ['Stadium','Arena','Athletic Park','Sports Park'],
    leagues: [
      { name: 'J1 Liga', tier: 1, teams: 18, promotion: 0, relegation: 2, continental: 3, foreignLimit: null },
      { name: 'J2 Liga', tier: 2, teams: 18, promotion: 2, relegation: 0, continental: 0, foreignLimit: null },
    ],
  },
  {
    code: 'AUT', name: 'Áustria', demonym: 'Áustria', wageScale: 0.6, strength: -16,
    firstNames: ['Lukas','David','Tobias','Elias','Jakob','Florian','Fabian','Marcel','Stefan','Julian','Christoph','Konrad','Valentin','Marko','Sasa','Andreas','Dominik','Patrick','Philipp','Kevin','Nicolas','Matthias','Michael','Alexander'],
    lastNames: ['Gruber','Huber','Bauer','Wagner','Müller','Pichler','Steiner','Moser','Mayer','Hofer','Leitner','Berger','Fuchs','Eder','Fischer','Schmid','Winkler','Weber','Schwarz','Maier','Schneider','Reiter','Mayr','Brunner'],
    cities: ['Alpenbach','Donaufeld','Kärntenau','Seefeldhof','Grünkirchen','Talburg','Hochwald','Murstadt','Innbruck-West','Linzach','Salzhofen','Steyrtal','Bergwies','Wolfsegg','Rosental-Ost','Traunsee'],
    clubPatterns: ['SK {c}','FC {c}','SV {c}','Austria {c}','Rapid {c}','LASK {c}','Admira {c}','WSG {c}'],
    stadiumNames: ['Stadion','Arena','Sportzentrum'],
    leagues: [
      { name: 'Bundesliga Austríaca', tier: 1, teams: 12, promotion: 0, relegation: 1, continental: 3, foreignLimit: null },
      { name: 'Zweite Liga Austríaca', tier: 2, teams: 16, promotion: 1, relegation: 0, continental: 0, foreignLimit: null },
    ],
  },
  {
    code: 'MEX', name: 'México', demonym: 'México', wageScale: 0.7, strength: -12,
    firstNames: ['José','Luis','Juan','Carlos','Jesús','Miguel','Diego','Alejandro','Jorge','Edson','Hirving','Rubén','Andrés','Santiago','Uriel','Érick','Orbelín','Guillermo','Héctor','César','Rogelio','Alexis','Julián','Sebastián'],
    lastNames: ['Hernández','García','Martínez','López','González','Rodríguez','Pérez','Sánchez','Ramírez','Cruz','Flores','Gómez','Morales','Vázquez','Reyes','Jiménez','Torres','Díaz','Gutiérrez','Ruiz','Mendoza','Aguilar','Ortiz','Castillo'],
    cities: ['Santa Fe del Valle','Puerto Esmeralda','San Cristóbal Alto','Ciudad Aurora','Villa Jacarandas','Tierra Blanca Norte','Lomas del Sol','Río Bravo Viejo','San Juan de las Peñas','Valle de Plata','Cerro Azul','Bahía de Ámbar','Nueva Tlalpan','Mesa Dorada','Real de Cobre','Agua Clara','Monte Albano','San Felipe del Mar','Costa Verde','Las Palmas Altas'],
    clubPatterns: ['Club {c}','Deportivo {c}','Atlético {c}','Real {c}','Tigres de {c}','Pumas de {c}','Rayados de {c}','Toros de {c}'],
    stadiumNames: ['Estadio','Estadio Olímpico','Coliseo'],
    leagues: [
      { name: 'Liga Mayor', tier: 1, teams: 18, promotion: 0, relegation: 1, continental: 3, foreignLimit: null },
      { name: 'Liga de Ascenso', tier: 2, teams: 18, promotion: 1, relegation: 0, continental: 0, foreignLimit: null },
    ],
  },
  {
    code: 'IRL', name: 'Irlanda', demonym: 'Irlanda', wageScale: 0.4, strength: -24,
    firstNames: ['Seán','Conor','Jack','Cian','Darragh','Oisín','Liam','Ryan','Adam','Shane','Callum','Niall','Ronan','Eoin','Aaron','Dylan','Kevin','Robbie','Séamus','Gavin','Evan','Ciarán','Killian','Fionn'],
    lastNames: ['Murphy','Kelly','O\'Sullivan','Walsh','Smith','O\'Brien','Byrne','Ryan','O\'Connor','O\'Neill','Doyle','McCarthy','Gallagher','Doherty','Kennedy','Lynch','Murray','Quinn','Moore','McLoughlin','Carroll','Connolly','Daly','Brennan'],
    cities: ['Ballymore','Kilcarran','Glenmara','Dunleary','Carrickbeg','Rathmoyle','Lisnagree','Ardcullen','Templemore Bay','Clonmara','Inishvale','Knockdrum'],
    clubPatterns: ['{c} FC','{c} Rovers','{c} Celtic','{c} City','{c} United','St. {c}','{c} Athletic','{c} Harps'],
    stadiumNames: ['Park','Stadium','Grounds'],
    leagues: [
      { name: 'Premier Division Irlandesa', tier: 1, teams: 10, promotion: 0, relegation: 1, continental: 2, foreignLimit: null },
      { name: 'First Division Irlandesa', tier: 2, teams: 10, promotion: 1, relegation: 0, continental: 0, foreignLimit: null },
    ],
  },
  {
    code: 'CRO', name: 'Croácia', demonym: 'Croácia', wageScale: 0.4, strength: -16,
    firstNames: ['Luka','Ivan','Marko','Josip','Zvonimir','Ante','Petar','Nikola','Mario','Dominik','Lovro','Bruno','Toma','Duje','Domagoj','Mislav','Filip','Kristijan','Dario','Andrej','Borna','Martin','Joško','Nikolaj'],
    lastNames: ['Horvat','Kovačević','Babić','Marić','Jurić','Novak','Kovačić','Knežević','Vuković','Marković','Petrović','Matić','Tomić','Pavlović','Božić','Perić','Blažević','Grgić','Šarić','Radić','Lovrić','Rakić','Vidović','Šimunović'],
    cities: ['Zagrebec','Splitograd','Rijekovac','Osijek-Gornji','Zadarski Brijeg','Pulaj','Dubravnik','Šibenac','Karlovec','Varaždinac','Vinkovec','Slavonski Dol'],
    clubPatterns: ['NK {c}','HNK {c}','GNK {c}','Hajduk {c}','Dinamo {c}','Lokomotiva {c}','Istra {c}','Slaven {c}'],
    stadiumNames: ['Stadion','Gradski stadion','Arena'],
    leagues: [
      { name: 'Prva Liga', tier: 1, teams: 10, promotion: 0, relegation: 1, continental: 2, foreignLimit: null },
      { name: 'Druga Liga', tier: 2, teams: 12, promotion: 1, relegation: 0, continental: 0, foreignLimit: null },
    ],
  },
  {
    code: 'RUS', name: 'Rússia', demonym: 'Rússia', wageScale: 0.8, strength: -12,
    firstNames: ['Aleksandr','Dmitri','Maksim','Sergei','Andrei','Aleksei','Artyom','Ivan','Nikita','Mikhail','Daniil','Yegor','Kirill','Roman','Vladimir','Igor','Denis','Pavel','Anton','Fyodor','Matvei','Ilya','Stanislav','Vyacheslav'],
    lastNames: ['Ivanov','Smirnov','Kuznetsov','Popov','Vasiliev','Petrov','Sokolov','Mikhailov','Novikov','Fedorov','Morozov','Volkov','Alekseev','Lebedev','Semyonov','Egorov','Pavlov','Kozlov','Stepanov','Nikolaev','Orlov','Andreev','Makarov','Zakharov'],
    cities: ['Severograd','Volzhsk-Novy','Belorechensk','Krasnoyarovo','Zarechny','Lesnogorsk','Svetlomorsk','Uralsk-Zapad','Donskoye','Kamensk-Polyarny','Ozyorsk','Rechnoy','Sosnovgorsk','Zvezdny','Yasnogorsk','Tikhoretsk-Novy','Pribrezhny','Gornovka'],
    clubPatterns: ['FK {c}','Dinamo {c}','Spartak {c}','Torpedo {c}','Lokomotiv {c}','Zenit {c}','Krylya {c}','Rotor {c}'],
    stadiumNames: ['Stadion','Arena','Tsentralny Stadion'],
    leagues: [
      { name: 'Premier Liga Russa', tier: 1, teams: 16, promotion: 0, relegation: 2, continental: 3, foreignLimit: null },
      { name: 'Pervaya Liga', tier: 2, teams: 18, promotion: 2, relegation: 0, continental: 0, foreignLimit: null },
    ],
  },
];

export const STADIUM_SUFFIX = ['Arena','Estádio Municipal','Park','Stadium','Parque','Estádio Central'];
