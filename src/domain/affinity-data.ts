// What brings today's countries close to each other (D174), as of 2026: their alliances, their economic blocs,
// the religion most of their people hold and the language they govern in. Names as in today's countries
// (data/natural-earth/countries-50m.json). Groups are weighted by how binding they are (a mutual-defence treaty 1,
// a forum 0.3). Sources: the organisations' own lists of members, as they stood in 2025; religion as the largest
// share in the Pew Research Center's estimates; the official or main language of government.

/** Military: alliances and mutual-defence treaties. Armenia's membership of the CSTO is frozen (since 2024). */
export const MILITARY: Array<{ name: string; weight: number; members: string[] }> = [
  { name: 'NATO', weight: 1, members: ['Albania', 'Belgium', 'Bulgaria', 'Canada', 'Croatia', 'Czech Republic', 'Denmark', 'Estonia', 'Finland', 'France', 'Germany', 'Greece', 'Hungary', 'Iceland', 'Italy', 'Latvia', 'Lithuania', 'Luxembourg', 'Montenegro', 'Netherlands', 'North Macedonia', 'Norway', 'Poland', 'Portugal', 'Romania', 'Slovakia', 'Slovenia', 'Spain', 'Sweden', 'Turkey', 'United Kingdom', 'United States of America', 'Greenland'] },
  { name: 'The EU\'s mutual defence clause', weight: 0.6, members: ['Austria', 'Belgium', 'Bulgaria', 'Croatia', 'Cyprus', 'Czech Republic', 'Denmark', 'Estonia', 'Finland', 'France', 'Germany', 'Greece', 'Hungary', 'Ireland', 'Italy', 'Latvia', 'Lithuania', 'Luxembourg', 'Malta', 'Netherlands', 'Poland', 'Portugal', 'Romania', 'Slovakia', 'Slovenia', 'Spain', 'Sweden'] },
  { name: 'The CSTO', weight: 1, members: ['Russia', 'Belarus', 'Kazakhstan', 'Kyrgyzstan', 'Tajikistan'] },
  { name: 'The Union State', weight: 1, members: ['Russia', 'Belarus'] },
  { name: 'Russia and North Korea\'s treaty (2024)', weight: 0.9, members: ['Russia', 'North Korea'] },
  { name: 'China and North Korea\'s treaty', weight: 0.8, members: ['China', 'North Korea'] },
  { name: 'The United States\' treaty allies in Asia and the Pacific', weight: 0.85, members: ['United States of America', 'Japan', 'South Korea', 'Philippines', 'Australia', 'Thailand'] },
  { name: 'ANZUS and AUKUS', weight: 0.8, members: ['Australia', 'New Zealand', 'United States of America', 'United Kingdom'] },
  { name: 'The United States\' major non-NATO allies', weight: 0.45, members: ['United States of America', 'Argentina', 'Australia', 'Bahrain', 'Brazil', 'Colombia', 'Egypt', 'Israel', 'Japan', 'Jordan', 'Kenya', 'Kuwait', 'Morocco', 'New Zealand', 'Pakistan', 'Philippines', 'Qatar', 'South Korea', 'Thailand', 'Tunisia', 'Taiwan'] },
  { name: 'The Rio Treaty', weight: 0.25, members: ['Argentina', 'Brazil', 'Chile', 'Colombia', 'Costa Rica', 'Dominican Republic', 'El Salvador', 'Guatemala', 'Haiti', 'Honduras', 'Panama', 'Paraguay', 'Peru', 'Trinidad and Tobago', 'United States of America', 'Uruguay', 'The Bahamas'] },
  { name: 'The Gulf Cooperation Council\'s Peninsula Shield', weight: 0.85, members: ['Saudi Arabia', 'United Arab Emirates', 'Kuwait', 'Qatar', 'Bahrain', 'Oman'] },
  { name: 'Saudi Arabia and Pakistan\'s mutual defence pact (2025)', weight: 0.85, members: ['Saudi Arabia', 'Pakistan'] },
  { name: 'Turkey and Azerbaijan\'s Shusha Declaration (2021)', weight: 1, members: ['Turkey', 'Azerbaijan'] },
  { name: 'The Alliance of Sahel States', weight: 0.9, members: ['Mali', 'Burkina Faso', 'Niger'] },
  { name: 'The Shanghai Cooperation Organisation', weight: 0.35, members: ['China', 'Russia', 'India', 'Pakistan', 'Iran', 'Kazakhstan', 'Kyrgyzstan', 'Tajikistan', 'Uzbekistan', 'Belarus'] },
  { name: 'The Arab League\'s joint defence treaty', weight: 0.2, members: ['Algeria', 'Bahrain', 'Comoros', 'Djibouti', 'Egypt', 'Iraq', 'Jordan', 'Kuwait', 'Lebanon', 'Libya', 'Mauritania', 'Morocco', 'Oman', 'Palestine', 'Qatar', 'Saudi Arabia', 'Somalia', 'Sudan', 'Syria', 'Tunisia', 'United Arab Emirates', 'Yemen'] },
  { name: 'Russia\'s base at Gyumri (a treaty to 2044)', weight: 0.4, members: ['Armenia', 'Russia'] },
  { name: 'Armenia and France\'s defence cooperation (2023)', weight: 0.25, members: ['Armenia', 'France'] },
  { name: 'Armenia and India\'s arms partnership', weight: 0.2, members: ['Armenia', 'India'] },
];

/** Economic: single markets, customs unions, trade areas and economic clubs. */
export const ECONOMIC: Array<{ name: string; weight: number; members: string[] }> = [
  { name: 'The European Union', weight: 1, members: ['Austria', 'Belgium', 'Bulgaria', 'Croatia', 'Cyprus', 'Czech Republic', 'Denmark', 'Estonia', 'Finland', 'France', 'Germany', 'Greece', 'Hungary', 'Ireland', 'Italy', 'Latvia', 'Lithuania', 'Luxembourg', 'Malta', 'Netherlands', 'Poland', 'Portugal', 'Romania', 'Slovakia', 'Slovenia', 'Spain', 'Sweden'] },
  { name: 'The European Economic Area and EFTA', weight: 0.75, members: ['Austria', 'Belgium', 'Bulgaria', 'Croatia', 'Cyprus', 'Czech Republic', 'Denmark', 'Estonia', 'Finland', 'France', 'Germany', 'Greece', 'Hungary', 'Ireland', 'Italy', 'Latvia', 'Lithuania', 'Luxembourg', 'Malta', 'Netherlands', 'Poland', 'Portugal', 'Romania', 'Slovakia', 'Slovenia', 'Spain', 'Sweden', 'Norway', 'Iceland', 'Liechtenstein', 'Switzerland'] },
  { name: 'The EU\'s customs union', weight: 0.45, members: ['Turkey', 'Andorra', 'San Marino', 'Monaco', 'France', 'Germany', 'Italy', 'Spain', 'Greece', 'Bulgaria', 'Romania', 'Netherlands', 'Belgium', 'Austria', 'Poland'] },
  { name: 'The Eurasian Economic Union', weight: 1, members: ['Russia', 'Belarus', 'Kazakhstan', 'Kyrgyzstan', 'Armenia'] },
  { name: 'The CIS free trade area', weight: 0.4, members: ['Russia', 'Belarus', 'Kazakhstan', 'Kyrgyzstan', 'Armenia', 'Moldova', 'Tajikistan', 'Uzbekistan'] },
  { name: 'The USMCA', weight: 1, members: ['United States of America', 'Canada', 'Mexico'] },
  { name: 'Mercosur', weight: 1, members: ['Argentina', 'Brazil', 'Paraguay', 'Uruguay', 'Bolivia'] },
  { name: 'The Pacific Alliance', weight: 0.6, members: ['Chile', 'Colombia', 'Mexico', 'Peru'] },
  { name: 'The Andean Community', weight: 0.7, members: ['Bolivia', 'Colombia', 'Ecuador', 'Peru'] },
  { name: 'CARICOM', weight: 0.7, members: ['Antigua and Barbuda', 'The Bahamas', 'Barbados', 'Belize', 'Dominica', 'Grenada', 'Guyana', 'Haiti', 'Jamaica', 'Montserrat', 'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines', 'Suriname', 'Trinidad and Tobago'] },
  { name: 'The Central American integration system', weight: 0.6, members: ['Guatemala', 'El Salvador', 'Honduras', 'Nicaragua', 'Costa Rica', 'Panama', 'Belize', 'Dominican Republic'] },
  { name: 'ASEAN', weight: 0.9, members: ['Brunei', 'Cambodia', 'Indonesia', 'Laos', 'Malaysia', 'Myanmar', 'Philippines', 'Singapore', 'Thailand', 'Vietnam', 'Timor-Leste'] },
  { name: 'The Regional Comprehensive Economic Partnership', weight: 0.5, members: ['Brunei', 'Cambodia', 'Indonesia', 'Laos', 'Malaysia', 'Myanmar', 'Philippines', 'Singapore', 'Thailand', 'Vietnam', 'China', 'Japan', 'South Korea', 'Australia', 'New Zealand'] },
  { name: 'The CPTPP', weight: 0.5, members: ['Australia', 'Brunei', 'Canada', 'Chile', 'Japan', 'Malaysia', 'Mexico', 'New Zealand', 'Peru', 'Singapore', 'Vietnam', 'United Kingdom'] },
  { name: 'Australia and New Zealand\'s closer economic relations', weight: 1, members: ['Australia', 'New Zealand'] },
  { name: 'The Gulf Cooperation Council', weight: 1, members: ['Saudi Arabia', 'United Arab Emirates', 'Kuwait', 'Qatar', 'Bahrain', 'Oman'] },
  { name: 'The Greater Arab Free Trade Area', weight: 0.3, members: ['Algeria', 'Bahrain', 'Egypt', 'Iraq', 'Jordan', 'Kuwait', 'Lebanon', 'Libya', 'Morocco', 'Oman', 'Palestine', 'Qatar', 'Saudi Arabia', 'Sudan', 'Syria', 'Tunisia', 'United Arab Emirates', 'Yemen'] },
  { name: 'ECOWAS', weight: 0.7, members: ['Benin', 'Cape Verde', 'Ivory Coast', 'The Gambia', 'Ghana', 'Guinea', 'Guinea-Bissau', 'Liberia', 'Nigeria', 'Senegal', 'Sierra Leone', 'Togo'] },
  { name: 'The West African monetary union', weight: 0.8, members: ['Benin', 'Burkina Faso', 'Ivory Coast', 'Guinea-Bissau', 'Mali', 'Niger', 'Senegal', 'Togo'] },
  { name: 'The Alliance of Sahel States', weight: 0.6, members: ['Mali', 'Burkina Faso', 'Niger'] },
  { name: 'The Central African monetary community', weight: 0.8, members: ['Cameroon', 'Central African Republic', 'Chad', 'Republic of the Congo', 'Equatorial Guinea', 'Gabon'] },
  { name: 'The East African Community', weight: 0.7, members: ['Kenya', 'Tanzania', 'Uganda', 'Rwanda', 'Burundi', 'South Sudan', 'Democratic Republic of the Congo', 'Somalia'] },
  { name: 'The Southern African Customs Union', weight: 1, members: ['South Africa', 'Botswana', 'Namibia', 'Lesotho', 'Eswatini'] },
  { name: 'SADC', weight: 0.5, members: ['Angola', 'Botswana', 'Comoros', 'Democratic Republic of the Congo', 'Eswatini', 'Lesotho', 'Madagascar', 'Malawi', 'Mauritius', 'Mozambique', 'Namibia', 'Seychelles', 'South Africa', 'Tanzania', 'Zambia', 'Zimbabwe'] },
  { name: 'The African Continental Free Trade Area', weight: 0.2, members: ['Algeria', 'Angola', 'Benin', 'Botswana', 'Burkina Faso', 'Burundi', 'Cameroon', 'Cape Verde', 'Central African Republic', 'Chad', 'Comoros', 'Democratic Republic of the Congo', 'Republic of the Congo', 'Djibouti', 'Egypt', 'Equatorial Guinea', 'Eswatini', 'Ethiopia', 'Gabon', 'The Gambia', 'Ghana', 'Guinea', 'Guinea-Bissau', 'Ivory Coast', 'Kenya', 'Lesotho', 'Liberia', 'Libya', 'Madagascar', 'Malawi', 'Mali', 'Mauritania', 'Mauritius', 'Morocco', 'Mozambique', 'Namibia', 'Niger', 'Nigeria', 'Rwanda', 'São Tomé and Príncipe', 'Senegal', 'Seychelles', 'Sierra Leone', 'Somalia', 'South Africa', 'South Sudan', 'Sudan', 'Tanzania', 'Togo', 'Tunisia', 'Uganda', 'Zambia', 'Zimbabwe', 'Western Sahara'] },
  { name: 'SAFTA', weight: 0.4, members: ['Afghanistan', 'Bangladesh', 'Bhutan', 'India', 'Maldives', 'Nepal', 'Pakistan', 'Sri Lanka'] },
  { name: 'The Economic Cooperation Organization', weight: 0.3, members: ['Afghanistan', 'Azerbaijan', 'Iran', 'Kazakhstan', 'Kyrgyzstan', 'Pakistan', 'Tajikistan', 'Turkey', 'Turkmenistan', 'Uzbekistan'] },
  { name: 'The Organization of Turkic States', weight: 0.45, members: ['Azerbaijan', 'Kazakhstan', 'Kyrgyzstan', 'Turkey', 'Uzbekistan'] },
  { name: 'BRICS', weight: 0.4, members: ['Brazil', 'Russia', 'India', 'China', 'South Africa', 'Egypt', 'Ethiopia', 'Iran', 'United Arab Emirates', 'Indonesia'] },
  { name: 'The G7', weight: 0.4, members: ['United States of America', 'United Kingdom', 'France', 'Germany', 'Italy', 'Japan', 'Canada'] },
  { name: 'The OECD', weight: 0.3, members: ['Australia', 'Austria', 'Belgium', 'Canada', 'Chile', 'Colombia', 'Costa Rica', 'Czech Republic', 'Denmark', 'Estonia', 'Finland', 'France', 'Germany', 'Greece', 'Hungary', 'Iceland', 'Ireland', 'Israel', 'Italy', 'Japan', 'South Korea', 'Latvia', 'Lithuania', 'Luxembourg', 'Mexico', 'Netherlands', 'New Zealand', 'Norway', 'Poland', 'Portugal', 'Slovakia', 'Slovenia', 'Spain', 'Sweden', 'Switzerland', 'Turkey', 'United Kingdom', 'United States of America'] },
  { name: 'The Pacific Islands Forum', weight: 0.4, members: ['Australia', 'New Zealand', 'Fiji', 'Papua New Guinea', 'Solomon Islands', 'Vanuatu', 'Samoa', 'Tonga', 'Kiribati', 'Tuvalu', 'Nauru', 'Marshall Islands', 'Palau', 'Federated States of Micronesia', 'Cook Islands', 'Niue', 'French Polynesia', 'New Caledonia'] },
];

/**
 * The religion most people hold: CAT Catholic, PRO Protestant, ORT Eastern Orthodox, OOR Oriental Orthodox
 * (Armenian, Ethiopian, Eritrean), CHR Christian of several churches, SUN Sunni Islam, SHI Shia Islam, IBA Ibadi
 * Islam, MUS Islam of both (Lebanon), JEW Judaism, HIN Hinduism, BUD Buddhism, JPN Shinto and Buddhism, FOLK
 * Chinese and Vietnamese folk religion, NONE most without religion.
 */
export const RELIGION: Record<string, string> = {
  Afghanistan: 'SUN', Albania: 'SUN', Algeria: 'SUN', Andorra: 'CAT', Angola: 'CAT', Argentina: 'CAT', Armenia: 'OOR', Australia: 'CHR', Austria: 'CAT', Azerbaijan: 'SHI',
  Bahrain: 'SHI', Bangladesh: 'SUN', Belarus: 'ORT', Belgium: 'CAT', Belize: 'CAT', Benin: 'CHR', Bhutan: 'BUD', Bolivia: 'CAT', 'Bosnia and Herzegovina': 'SUN', Botswana: 'PRO',
  Brazil: 'CAT', Brunei: 'SUN', Bulgaria: 'ORT', 'Burkina Faso': 'SUN', Burundi: 'CAT', Cambodia: 'BUD', Cameroon: 'CHR', Canada: 'CHR', 'Cape Verde': 'CAT', 'Central African Republic': 'CHR',
  Chad: 'SUN', Chile: 'CAT', China: 'FOLK', Colombia: 'CAT', Comoros: 'SUN', 'Costa Rica': 'CAT', Croatia: 'CAT', Cuba: 'CAT', Cyprus: 'ORT', 'Czech Republic': 'NONE',
  'Democratic Republic of the Congo': 'CHR', Denmark: 'PRO', Djibouti: 'SUN', 'Dominican Republic': 'CAT', Ecuador: 'CAT', Egypt: 'SUN', 'El Salvador': 'CAT', 'Equatorial Guinea': 'CAT', Eritrea: 'OOR', Estonia: 'NONE',
  Eswatini: 'PRO', Ethiopia: 'OOR', Fiji: 'CHR', Finland: 'PRO', France: 'CAT', Gabon: 'CAT', Georgia: 'ORT', Germany: 'CHR', Ghana: 'PRO', Greece: 'ORT',
  Guatemala: 'CAT', Guinea: 'SUN', 'Guinea-Bissau': 'SUN', Guyana: 'CHR', Haiti: 'CAT', Honduras: 'CAT', Hungary: 'CAT', Iceland: 'PRO', India: 'HIN', Indonesia: 'SUN',
  Iran: 'SHI', Iraq: 'SHI', Ireland: 'CAT', Israel: 'JEW', Italy: 'CAT', 'Ivory Coast': 'SUN', Jamaica: 'PRO', Japan: 'JPN', Jordan: 'SUN', Kazakhstan: 'SUN',
  Kenya: 'PRO', Kosovo: 'SUN', Kuwait: 'SUN', Kyrgyzstan: 'SUN', Laos: 'BUD', Latvia: 'CHR', Lebanon: 'MUS', Lesotho: 'CHR', Liberia: 'PRO', Libya: 'SUN',
  Liechtenstein: 'CAT', Lithuania: 'CAT', Luxembourg: 'CAT', Madagascar: 'CHR', Malawi: 'PRO', Malaysia: 'SUN', Maldives: 'SUN', Mali: 'SUN', Malta: 'CAT', Mauritania: 'SUN',
  Mauritius: 'HIN', Mexico: 'CAT', Moldova: 'ORT', Monaco: 'CAT', Mongolia: 'BUD', Montenegro: 'ORT', Morocco: 'SUN', Mozambique: 'CHR', Myanmar: 'BUD', Namibia: 'PRO',
  Nepal: 'HIN', Netherlands: 'NONE', 'New Zealand': 'NONE', Nicaragua: 'CAT', Niger: 'SUN', Nigeria: 'SUN', 'North Korea': 'NONE', 'North Macedonia': 'ORT', Norway: 'PRO', Oman: 'IBA',
  Pakistan: 'SUN', Palestine: 'SUN', Panama: 'CAT', 'Papua New Guinea': 'PRO', Paraguay: 'CAT', Peru: 'CAT', Philippines: 'CAT', Poland: 'CAT', Portugal: 'CAT', Qatar: 'SUN',
  'Republic of the Congo': 'CHR', Romania: 'ORT', Russia: 'ORT', Rwanda: 'CHR', 'Saudi Arabia': 'SUN', Senegal: 'SUN', Serbia: 'ORT', 'Sierra Leone': 'SUN', Singapore: 'BUD', Slovakia: 'CAT',
  Slovenia: 'CAT', 'Solomon Islands': 'PRO', Somalia: 'SUN', Somaliland: 'SUN', 'South Africa': 'PRO', 'South Korea': 'NONE', 'South Sudan': 'CHR', Spain: 'CAT', 'Sri Lanka': 'BUD', Sudan: 'SUN',
  Suriname: 'CHR', Sweden: 'NONE', Switzerland: 'CHR', Syria: 'SUN', Taiwan: 'FOLK', Tajikistan: 'SUN', Tanzania: 'CHR', Thailand: 'BUD', 'The Bahamas': 'PRO', 'The Gambia': 'SUN',
  'Timor-Leste': 'CAT', Togo: 'CHR', 'Trinidad and Tobago': 'CHR', Tunisia: 'SUN', Turkey: 'SUN', Turkmenistan: 'SUN', 'Turkish Republic of Northern Cyprus': 'SUN', Uganda: 'CHR', Ukraine: 'ORT', 'United Arab Emirates': 'SUN',
  'United Kingdom': 'CHR', 'United States of America': 'PRO', Uruguay: 'CAT', Uzbekistan: 'SUN', Vanuatu: 'PRO', Venezuela: 'CAT', Vietnam: 'FOLK', 'Western Sahara': 'SUN', Yemen: 'SUN', Zambia: 'PRO',
  Zimbabwe: 'PRO', Greenland: 'PRO', 'Puerto Rico': 'CAT', 'Hong Kong': 'FOLK', Macau: 'FOLK', 'New Caledonia': 'CAT', 'French Polynesia': 'PRO', Samoa: 'PRO', Tonga: 'PRO', Kiribati: 'CAT',
  Tuvalu: 'PRO', Nauru: 'PRO', 'Marshall Islands': 'PRO', Palau: 'CAT', 'Federated States of Micronesia': 'CAT', Barbados: 'PRO', 'Antigua and Barbuda': 'PRO', Dominica: 'CAT', Grenada: 'CAT', 'Saint Lucia': 'CAT',
  'Saint Kitts and Nevis': 'PRO', 'Saint Vincent and the Grenadines': 'PRO', 'São Tomé and Príncipe': 'CAT', Seychelles: 'CAT', 'San Marino': 'CAT', 'Vatican City': 'CAT', 'Faroe Islands': 'PRO', 'Isle of Man': 'CHR', Jersey: 'CHR', Guernsey: 'CHR',
};

/** The language of government (its ISO 639-1 code), for its family and branch. */
export const LANGUAGE: Record<string, string> = {
  Afghanistan: 'ps', Albania: 'sq', Algeria: 'ar', Andorra: 'ca', Angola: 'pt', Argentina: 'es', Armenia: 'hy', Australia: 'en', Austria: 'de', Azerbaijan: 'az',
  Bahrain: 'ar', Bangladesh: 'bn', Belarus: 'ru', Belgium: 'nl', Belize: 'en', Benin: 'fr', Bhutan: 'dz', Bolivia: 'es', 'Bosnia and Herzegovina': 'bs', Botswana: 'en',
  Brazil: 'pt', Brunei: 'ms', Bulgaria: 'bg', 'Burkina Faso': 'fr', Burundi: 'rn', Cambodia: 'km', Cameroon: 'fr', Canada: 'en', 'Cape Verde': 'pt', 'Central African Republic': 'fr',
  Chad: 'fr', Chile: 'es', China: 'zh', Colombia: 'es', Comoros: 'ar', 'Costa Rica': 'es', Croatia: 'hr', Cuba: 'es', Cyprus: 'el', 'Czech Republic': 'cs',
  'Democratic Republic of the Congo': 'fr', Denmark: 'da', Djibouti: 'fr', 'Dominican Republic': 'es', Ecuador: 'es', Egypt: 'ar', 'El Salvador': 'es', 'Equatorial Guinea': 'es', Eritrea: 'ti', Estonia: 'et',
  Eswatini: 'en', Ethiopia: 'am', Fiji: 'en', Finland: 'fi', France: 'fr', Gabon: 'fr', Georgia: 'ka', Germany: 'de', Ghana: 'en', Greece: 'el',
  Guatemala: 'es', Guinea: 'fr', 'Guinea-Bissau': 'pt', Guyana: 'en', Haiti: 'fr', Honduras: 'es', Hungary: 'hu', Iceland: 'is', India: 'hi', Indonesia: 'id',
  Iran: 'fa', Iraq: 'ar', Ireland: 'en', Israel: 'he', Italy: 'it', 'Ivory Coast': 'fr', Jamaica: 'en', Japan: 'ja', Jordan: 'ar', Kazakhstan: 'kk',
  Kenya: 'sw', Kosovo: 'sq', Kuwait: 'ar', Kyrgyzstan: 'ky', Laos: 'lo', Latvia: 'lv', Lebanon: 'ar', Lesotho: 'en', Liberia: 'en', Libya: 'ar',
  Liechtenstein: 'de', Lithuania: 'lt', Luxembourg: 'lb', Madagascar: 'mg', Malawi: 'en', Malaysia: 'ms', Maldives: 'dv', Mali: 'fr', Malta: 'mt', Mauritania: 'ar',
  Mauritius: 'en', Mexico: 'es', Moldova: 'ro', Monaco: 'fr', Mongolia: 'mn', Montenegro: 'sr', Morocco: 'ar', Mozambique: 'pt', Myanmar: 'my', Namibia: 'en',
  Nepal: 'ne', Netherlands: 'nl', 'New Zealand': 'en', Nicaragua: 'es', Niger: 'fr', Nigeria: 'en', 'North Korea': 'ko', 'North Macedonia': 'mk', Norway: 'no', Oman: 'ar',
  Pakistan: 'ur', Palestine: 'ar', Panama: 'es', 'Papua New Guinea': 'en', Paraguay: 'es', Peru: 'es', Philippines: 'tl', Poland: 'pl', Portugal: 'pt', Qatar: 'ar',
  'Republic of the Congo': 'fr', Romania: 'ro', Russia: 'ru', Rwanda: 'rw', 'Saudi Arabia': 'ar', Senegal: 'fr', Serbia: 'sr', 'Sierra Leone': 'en', Singapore: 'en', Slovakia: 'sk',
  Slovenia: 'sl', 'Solomon Islands': 'en', Somalia: 'so', Somaliland: 'so', 'South Africa': 'en', 'South Korea': 'ko', 'South Sudan': 'en', Spain: 'es', 'Sri Lanka': 'si', Sudan: 'ar',
  Suriname: 'nl', Sweden: 'sv', Switzerland: 'de', Syria: 'ar', Taiwan: 'zh', Tajikistan: 'tg', Tanzania: 'sw', Thailand: 'th', 'The Bahamas': 'en', 'The Gambia': 'en',
  'Timor-Leste': 'pt', Togo: 'fr', 'Trinidad and Tobago': 'en', Tunisia: 'ar', Turkey: 'tr', Turkmenistan: 'tk', 'Turkish Republic of Northern Cyprus': 'tr', Uganda: 'en', Ukraine: 'uk', 'United Arab Emirates': 'ar',
  'United Kingdom': 'en', 'United States of America': 'en', Uruguay: 'es', Uzbekistan: 'uz', Vanuatu: 'bi', Venezuela: 'es', Vietnam: 'vi', 'Western Sahara': 'ar', Yemen: 'ar', Zambia: 'en',
  Zimbabwe: 'en', Greenland: 'kl', 'Puerto Rico': 'es', 'Hong Kong': 'zh', Macau: 'zh', 'New Caledonia': 'fr', 'French Polynesia': 'fr', Samoa: 'sm', Tonga: 'to', Kiribati: 'en',
  Tuvalu: 'en', Nauru: 'en', 'Marshall Islands': 'en', Palau: 'en', 'Federated States of Micronesia': 'en', Barbados: 'en', 'Antigua and Barbuda': 'en', Dominica: 'en', Grenada: 'en', 'Saint Lucia': 'en',
  'Saint Kitts and Nevis': 'en', 'Saint Vincent and the Grenadines': 'en', 'São Tomé and Príncipe': 'pt', Seychelles: 'fr', 'San Marino': 'it', 'Vatican City': 'it', 'Faroe Islands': 'fo', 'Isle of Man': 'en', Jersey: 'en', Guernsey: 'en',
};

/** Each language's family and branch. */
export const LANGUAGE_FAMILY: Record<string, [string, string]> = {
  en: ['Indo-European', 'Germanic'], de: ['Indo-European', 'Germanic'], nl: ['Indo-European', 'Germanic'], lb: ['Indo-European', 'Germanic'], da: ['Indo-European', 'Germanic'], no: ['Indo-European', 'Germanic'], sv: ['Indo-European', 'Germanic'], is: ['Indo-European', 'Germanic'], fo: ['Indo-European', 'Germanic'],
  fr: ['Indo-European', 'Romance'], es: ['Indo-European', 'Romance'], pt: ['Indo-European', 'Romance'], it: ['Indo-European', 'Romance'], ro: ['Indo-European', 'Romance'], ca: ['Indo-European', 'Romance'],
  ru: ['Indo-European', 'Slavic'], uk: ['Indo-European', 'Slavic'], pl: ['Indo-European', 'Slavic'], cs: ['Indo-European', 'Slavic'], sk: ['Indo-European', 'Slavic'], sl: ['Indo-European', 'Slavic'], hr: ['Indo-European', 'Slavic'], sr: ['Indo-European', 'Slavic'], bs: ['Indo-European', 'Slavic'], mk: ['Indo-European', 'Slavic'], bg: ['Indo-European', 'Slavic'],
  lt: ['Indo-European', 'Baltic'], lv: ['Indo-European', 'Baltic'], el: ['Indo-European', 'Hellenic'], hy: ['Indo-European', 'Armenian'], sq: ['Indo-European', 'Albanian'],
  fa: ['Indo-European', 'Iranian'], ps: ['Indo-European', 'Iranian'], tg: ['Indo-European', 'Iranian'],
  hi: ['Indo-European', 'Indo-Aryan'], ur: ['Indo-European', 'Indo-Aryan'], bn: ['Indo-European', 'Indo-Aryan'], ne: ['Indo-European', 'Indo-Aryan'], si: ['Indo-European', 'Indo-Aryan'], dv: ['Indo-European', 'Indo-Aryan'],
  tr: ['Turkic', 'Oghuz'], az: ['Turkic', 'Oghuz'], tk: ['Turkic', 'Oghuz'], kk: ['Turkic', 'Kipchak'], ky: ['Turkic', 'Kipchak'], uz: ['Turkic', 'Karluk'],
  ar: ['Afro-Asiatic', 'Semitic'], he: ['Afro-Asiatic', 'Semitic'], mt: ['Afro-Asiatic', 'Semitic'], am: ['Afro-Asiatic', 'Semitic'], ti: ['Afro-Asiatic', 'Semitic'], so: ['Afro-Asiatic', 'Cushitic'],
  fi: ['Uralic', 'Finnic'], et: ['Uralic', 'Finnic'], hu: ['Uralic', 'Ugric'], ka: ['Kartvelian', 'Kartvelian'], mn: ['Mongolic', 'Mongolic'], kl: ['Eskimo-Aleut', 'Inuit'],
  zh: ['Sino-Tibetan', 'Sinitic'], my: ['Sino-Tibetan', 'Tibeto-Burman'], dz: ['Sino-Tibetan', 'Tibeto-Burman'], ja: ['Japonic', 'Japonic'], ko: ['Koreanic', 'Koreanic'],
  th: ['Kra-Dai', 'Tai'], lo: ['Kra-Dai', 'Tai'], vi: ['Austroasiatic', 'Vietic'], km: ['Austroasiatic', 'Khmer'],
  ms: ['Austronesian', 'Malayic'], id: ['Austronesian', 'Malayic'], tl: ['Austronesian', 'Philippine'], mg: ['Austronesian', 'Barito'], sm: ['Austronesian', 'Polynesian'], to: ['Austronesian', 'Polynesian'], bi: ['Creole', 'Creole'],
  sw: ['Niger-Congo', 'Bantu'], rw: ['Niger-Congo', 'Bantu'], rn: ['Niger-Congo', 'Bantu'],
};
