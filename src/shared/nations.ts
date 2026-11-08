/**
 * Nacionalidades que um jogador ou técnico pode ter. É só um rótulo com bandeira: a nação NÃO precisa existir
 * no universo (sem ligas, clubes nem simulação). Os países do universo (`countries`) têm prioridade no nome;
 * esta lista cobre o resto. Códigos de 3 letras no padrão FIFA (os mesmos da base: ENG, GER, NED, URU…);
 * `iso` é o código ISO 3166-1 alfa-2 (ou subdivisão, como gb-eng) usado para achar a bandeira em `flag-icons`.
 */
export interface Nation { code: string; name: string; iso: string }

export const NATIONS: readonly Nation[] = [
  // Europa
  { code: 'ALB', name: 'Albânia', iso: 'al' }, { code: 'AND', name: 'Andorra', iso: 'ad' }, { code: 'ARM', name: 'Armênia', iso: 'am' },
  { code: 'AUT', name: 'Áustria', iso: 'at' }, { code: 'AZE', name: 'Azerbaijão', iso: 'az' }, { code: 'BLR', name: 'Belarus', iso: 'by' },
  { code: 'BEL', name: 'Bélgica', iso: 'be' }, { code: 'BIH', name: 'Bósnia e Herzegovina', iso: 'ba' }, { code: 'BUL', name: 'Bulgária', iso: 'bg' },
  { code: 'CRO', name: 'Croácia', iso: 'hr' }, { code: 'CYP', name: 'Chipre', iso: 'cy' }, { code: 'CZE', name: 'Tchéquia', iso: 'cz' },
  { code: 'DEN', name: 'Dinamarca', iso: 'dk' }, { code: 'ENG', name: 'Inglaterra', iso: 'gb-eng' }, { code: 'EST', name: 'Estônia', iso: 'ee' },
  { code: 'FRO', name: 'Ilhas Faroé', iso: 'fo' }, { code: 'FIN', name: 'Finlândia', iso: 'fi' }, { code: 'FRA', name: 'França', iso: 'fr' },
  { code: 'GEO', name: 'Geórgia', iso: 'ge' }, { code: 'GER', name: 'Alemanha', iso: 'de' }, { code: 'GIB', name: 'Gibraltar', iso: 'gi' },
  { code: 'GRE', name: 'Grécia', iso: 'gr' }, { code: 'HUN', name: 'Hungria', iso: 'hu' }, { code: 'ISL', name: 'Islândia', iso: 'is' },
  { code: 'IRL', name: 'Irlanda', iso: 'ie' }, { code: 'ISR', name: 'Israel', iso: 'il' }, { code: 'ITA', name: 'Itália', iso: 'it' },
  { code: 'KAZ', name: 'Cazaquistão', iso: 'kz' }, { code: 'KVX', name: 'Kosovo', iso: 'xk' }, { code: 'LVA', name: 'Letônia', iso: 'lv' },
  { code: 'LIE', name: 'Liechtenstein', iso: 'li' }, { code: 'LTU', name: 'Lituânia', iso: 'lt' }, { code: 'LUX', name: 'Luxemburgo', iso: 'lu' },
  { code: 'MLT', name: 'Malta', iso: 'mt' }, { code: 'MDA', name: 'Moldávia', iso: 'md' }, { code: 'MNE', name: 'Montenegro', iso: 'me' },
  { code: 'NED', name: 'Holanda', iso: 'nl' }, { code: 'MKD', name: 'Macedônia do Norte', iso: 'mk' }, { code: 'NIR', name: 'Irlanda do Norte', iso: 'gb-nir' },
  { code: 'NOR', name: 'Noruega', iso: 'no' }, { code: 'POL', name: 'Polônia', iso: 'pl' }, { code: 'POR', name: 'Portugal', iso: 'pt' },
  { code: 'ROU', name: 'Romênia', iso: 'ro' }, { code: 'RUS', name: 'Rússia', iso: 'ru' }, { code: 'SMR', name: 'San Marino', iso: 'sm' },
  { code: 'SCO', name: 'Escócia', iso: 'gb-sct' }, { code: 'SRB', name: 'Sérvia', iso: 'rs' }, { code: 'SVK', name: 'Eslováquia', iso: 'sk' },
  { code: 'SVN', name: 'Eslovênia', iso: 'si' }, { code: 'ESP', name: 'Espanha', iso: 'es' }, { code: 'SWE', name: 'Suécia', iso: 'se' },
  { code: 'SUI', name: 'Suíça', iso: 'ch' }, { code: 'TUR', name: 'Turquia', iso: 'tr' }, { code: 'UKR', name: 'Ucrânia', iso: 'ua' },
  { code: 'WAL', name: 'País de Gales', iso: 'gb-wls' },
  // América do Sul
  { code: 'ARG', name: 'Argentina', iso: 'ar' }, { code: 'BOL', name: 'Bolívia', iso: 'bo' }, { code: 'BRA', name: 'Brasil', iso: 'br' },
  { code: 'CHI', name: 'Chile', iso: 'cl' }, { code: 'COL', name: 'Colômbia', iso: 'co' }, { code: 'ECU', name: 'Equador', iso: 'ec' },
  { code: 'PAR', name: 'Paraguai', iso: 'py' }, { code: 'PER', name: 'Peru', iso: 'pe' }, { code: 'URU', name: 'Uruguai', iso: 'uy' },
  { code: 'VEN', name: 'Venezuela', iso: 've' },
  // América do Norte, Central e Caribe
  { code: 'AIA', name: 'Anguila', iso: 'ai' }, { code: 'ATG', name: 'Antígua e Barbuda', iso: 'ag' }, { code: 'ARU', name: 'Aruba', iso: 'aw' },
  { code: 'BAH', name: 'Bahamas', iso: 'bs' }, { code: 'BRB', name: 'Barbados', iso: 'bb' }, { code: 'BLZ', name: 'Belize', iso: 'bz' },
  { code: 'BER', name: 'Bermudas', iso: 'bm' }, { code: 'CAN', name: 'Canadá', iso: 'ca' }, { code: 'CAY', name: 'Ilhas Cayman', iso: 'ky' },
  { code: 'CRC', name: 'Costa Rica', iso: 'cr' }, { code: 'CUB', name: 'Cuba', iso: 'cu' }, { code: 'CUW', name: 'Curaçao', iso: 'cw' },
  { code: 'DMA', name: 'Dominica', iso: 'dm' }, { code: 'DOM', name: 'República Dominicana', iso: 'do' }, { code: 'SLV', name: 'El Salvador', iso: 'sv' },
  { code: 'GRN', name: 'Granada', iso: 'gd' }, { code: 'GUA', name: 'Guatemala', iso: 'gt' }, { code: 'GUY', name: 'Guiana', iso: 'gy' },
  { code: 'HAI', name: 'Haiti', iso: 'ht' }, { code: 'HON', name: 'Honduras', iso: 'hn' }, { code: 'JAM', name: 'Jamaica', iso: 'jm' },
  { code: 'MEX', name: 'México', iso: 'mx' }, { code: 'MSR', name: 'Montserrat', iso: 'ms' }, { code: 'NCA', name: 'Nicarágua', iso: 'ni' },
  { code: 'PAN', name: 'Panamá', iso: 'pa' }, { code: 'PUR', name: 'Porto Rico', iso: 'pr' }, { code: 'SKN', name: 'São Cristóvão e Névis', iso: 'kn' },
  { code: 'LCA', name: 'Santa Lúcia', iso: 'lc' }, { code: 'VIN', name: 'São Vicente e Granadinas', iso: 'vc' }, { code: 'SUR', name: 'Suriname', iso: 'sr' },
  { code: 'TRI', name: 'Trinidad e Tobago', iso: 'tt' }, { code: 'TCA', name: 'Ilhas Turcas e Caicos', iso: 'tc' }, { code: 'USA', name: 'Estados Unidos', iso: 'us' },
  { code: 'VGB', name: 'Ilhas Virgens Britânicas', iso: 'vg' }, { code: 'VIR', name: 'Ilhas Virgens Americanas', iso: 'vi' },
  // África
  { code: 'ALG', name: 'Argélia', iso: 'dz' }, { code: 'ANG', name: 'Angola', iso: 'ao' }, { code: 'BEN', name: 'Benin', iso: 'bj' },
  { code: 'BOT', name: 'Botsuana', iso: 'bw' }, { code: 'BFA', name: 'Burkina Faso', iso: 'bf' }, { code: 'BDI', name: 'Burundi', iso: 'bi' },
  { code: 'CMR', name: 'Camarões', iso: 'cm' }, { code: 'CPV', name: 'Cabo Verde', iso: 'cv' }, { code: 'CTA', name: 'República Centro-Africana', iso: 'cf' },
  { code: 'CHA', name: 'Chade', iso: 'td' }, { code: 'COM', name: 'Comores', iso: 'km' }, { code: 'CGO', name: 'Congo', iso: 'cg' },
  { code: 'COD', name: 'RD Congo', iso: 'cd' }, { code: 'CIV', name: 'Costa do Marfim', iso: 'ci' }, { code: 'DJI', name: 'Djibuti', iso: 'dj' },
  { code: 'EGY', name: 'Egito', iso: 'eg' }, { code: 'EQG', name: 'Guiné Equatorial', iso: 'gq' }, { code: 'ERI', name: 'Eritreia', iso: 'er' },
  { code: 'SWZ', name: 'Essuatíni', iso: 'sz' }, { code: 'ETH', name: 'Etiópia', iso: 'et' }, { code: 'GAB', name: 'Gabão', iso: 'ga' },
  { code: 'GAM', name: 'Gâmbia', iso: 'gm' }, { code: 'GHA', name: 'Gana', iso: 'gh' }, { code: 'GUI', name: 'Guiné', iso: 'gn' },
  { code: 'GNB', name: 'Guiné-Bissau', iso: 'gw' }, { code: 'KEN', name: 'Quênia', iso: 'ke' }, { code: 'LES', name: 'Lesoto', iso: 'ls' },
  { code: 'LBR', name: 'Libéria', iso: 'lr' }, { code: 'LBY', name: 'Líbia', iso: 'ly' }, { code: 'MAD', name: 'Madagascar', iso: 'mg' },
  { code: 'MWI', name: 'Malaui', iso: 'mw' }, { code: 'MLI', name: 'Mali', iso: 'ml' }, { code: 'MTN', name: 'Mauritânia', iso: 'mr' },
  { code: 'MRI', name: 'Maurício', iso: 'mu' }, { code: 'MAR', name: 'Marrocos', iso: 'ma' }, { code: 'MOZ', name: 'Moçambique', iso: 'mz' },
  { code: 'NAM', name: 'Namíbia', iso: 'na' }, { code: 'NIG', name: 'Níger', iso: 'ne' }, { code: 'NGA', name: 'Nigéria', iso: 'ng' },
  { code: 'RWA', name: 'Ruanda', iso: 'rw' }, { code: 'STP', name: 'São Tomé e Príncipe', iso: 'st' }, { code: 'SEN', name: 'Senegal', iso: 'sn' },
  { code: 'SEY', name: 'Seicheles', iso: 'sc' }, { code: 'SLE', name: 'Serra Leoa', iso: 'sl' }, { code: 'SOM', name: 'Somália', iso: 'so' },
  { code: 'RSA', name: 'África do Sul', iso: 'za' }, { code: 'SSD', name: 'Sudão do Sul', iso: 'ss' }, { code: 'SDN', name: 'Sudão', iso: 'sd' },
  { code: 'TAN', name: 'Tanzânia', iso: 'tz' }, { code: 'TOG', name: 'Togo', iso: 'tg' }, { code: 'TUN', name: 'Tunísia', iso: 'tn' },
  { code: 'UGA', name: 'Uganda', iso: 'ug' }, { code: 'ZAM', name: 'Zâmbia', iso: 'zm' }, { code: 'ZIM', name: 'Zimbábue', iso: 'zw' },
  // Ásia
  { code: 'AFG', name: 'Afeganistão', iso: 'af' }, { code: 'AUS', name: 'Austrália', iso: 'au' }, { code: 'BHR', name: 'Bahrein', iso: 'bh' },
  { code: 'BAN', name: 'Bangladesh', iso: 'bd' }, { code: 'BHU', name: 'Butão', iso: 'bt' }, { code: 'BRU', name: 'Brunei', iso: 'bn' },
  { code: 'CAM', name: 'Camboja', iso: 'kh' }, { code: 'CHN', name: 'China', iso: 'cn' }, { code: 'TPE', name: 'Taiwan', iso: 'tw' },
  { code: 'GUM', name: 'Guam', iso: 'gu' }, { code: 'HKG', name: 'Hong Kong', iso: 'hk' }, { code: 'IND', name: 'Índia', iso: 'in' },
  { code: 'IDN', name: 'Indonésia', iso: 'id' }, { code: 'IRN', name: 'Irã', iso: 'ir' }, { code: 'IRQ', name: 'Iraque', iso: 'iq' },
  { code: 'JPN', name: 'Japão', iso: 'jp' }, { code: 'JOR', name: 'Jordânia', iso: 'jo' }, { code: 'PRK', name: 'Coreia do Norte', iso: 'kp' },
  { code: 'KOR', name: 'Coreia do Sul', iso: 'kr' }, { code: 'KUW', name: 'Kuwait', iso: 'kw' }, { code: 'KGZ', name: 'Quirguistão', iso: 'kg' },
  { code: 'LAO', name: 'Laos', iso: 'la' }, { code: 'LBN', name: 'Líbano', iso: 'lb' }, { code: 'MAC', name: 'Macau', iso: 'mo' },
  { code: 'MAS', name: 'Malásia', iso: 'my' }, { code: 'MDV', name: 'Maldivas', iso: 'mv' }, { code: 'MNG', name: 'Mongólia', iso: 'mn' },
  { code: 'MYA', name: 'Mianmar', iso: 'mm' }, { code: 'NEP', name: 'Nepal', iso: 'np' }, { code: 'OMA', name: 'Omã', iso: 'om' },
  { code: 'PAK', name: 'Paquistão', iso: 'pk' }, { code: 'PLE', name: 'Palestina', iso: 'ps' }, { code: 'PHI', name: 'Filipinas', iso: 'ph' },
  { code: 'QAT', name: 'Catar', iso: 'qa' }, { code: 'KSA', name: 'Arábia Saudita', iso: 'sa' }, { code: 'SGP', name: 'Singapura', iso: 'sg' },
  { code: 'SRI', name: 'Sri Lanka', iso: 'lk' }, { code: 'SYR', name: 'Síria', iso: 'sy' }, { code: 'TJK', name: 'Tajiquistão', iso: 'tj' },
  { code: 'THA', name: 'Tailândia', iso: 'th' }, { code: 'TLS', name: 'Timor-Leste', iso: 'tl' }, { code: 'TKM', name: 'Turcomenistão', iso: 'tm' },
  { code: 'UAE', name: 'Emirados Árabes Unidos', iso: 'ae' }, { code: 'UZB', name: 'Uzbequistão', iso: 'uz' }, { code: 'VIE', name: 'Vietnã', iso: 'vn' },
  { code: 'YEM', name: 'Iêmen', iso: 'ye' },
  // Oceania
  { code: 'ASA', name: 'Samoa Americana', iso: 'as' }, { code: 'COK', name: 'Ilhas Cook', iso: 'ck' }, { code: 'FIJ', name: 'Fiji', iso: 'fj' },
  { code: 'NCL', name: 'Nova Caledônia', iso: 'nc' }, { code: 'NZL', name: 'Nova Zelândia', iso: 'nz' }, { code: 'PNG', name: 'Papua-Nova Guiné', iso: 'pg' },
  { code: 'SAM', name: 'Samoa', iso: 'ws' }, { code: 'SOL', name: 'Ilhas Salomão', iso: 'sb' }, { code: 'TAH', name: 'Taiti', iso: 'pf' },
  { code: 'TGA', name: 'Tonga', iso: 'to' }, { code: 'VAN', name: 'Vanuatu', iso: 'vu' },
];

const BY_CODE = new Map(NATIONS.map((n) => [n.code, n]));
/** Nação pelo código de 3 letras (ou undefined). */
export const nationOf = (code: string): Nation | undefined => BY_CODE.get(code);
/** Nome da nacionalidade: o do universo, se o país existir lá; senão o desta lista; senão o próprio código. */
export const nationName = (code: string, universeName?: string | null): string => universeName ?? BY_CODE.get(code)?.name ?? code;

/** Opções para escolher a nacionalidade: países do universo + esta lista, sem repetir código, em ordem alfabética. */
export function nationalityOptions(universe: ReadonlyArray<{ code: string; name: string }>): Array<{ code: string; name: string }> {
  const out = new Map<string, string>();
  for (const c of universe) out.set(c.code, c.name);
  for (const n of NATIONS) if (!out.has(n.code)) out.set(n.code, n.name);
  return [...out].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
