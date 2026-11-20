// Icons for characters (fifth feedback round, D85): ships, aircraft, land forces, military signs, people
// and places, drawn as shapes so they are sharp at any size (an 8K export too) and take the character's
// colour. Each is drawn on a 64 by 64 grid: side views face right (east), views from above face up
// (north). `solid` is the icon; `detail` is drawn over it in the contrasting colour (windows, wheels,
// gun ports); `top` again in the icon's colour over the detail; `line` is stroked in the icon's colour.

/** How an icon follows its character's travel: turned to face it (seen from above), flipped to face east or west (seen from the side), or not at all. */
export type IconTurn = 'rotate' | 'mirror' | 'none';
export type IconGroup = 'Ships' | 'Aircraft' | 'On land' | 'Military signs' | 'People and places' | 'Fantasy';

export interface IconDef {
  id: string;
  name: string;
  group: IconGroup;
  turn: IconTurn;
  solid: string;
  detail?: string;
  top?: string;
  line?: string;
  /** Width of `line`, in grid units (64 across). */
  lineWidth?: number;
}

const circle = (x: number, y: number, r: number) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
const circles = (pts: Array<[number, number]>, r: number) => pts.map(([x, y]) => circle(x, y, r)).join('');

export const ICON_GROUPS: IconGroup[] = ['Ships', 'Aircraft', 'On land', 'Military signs', 'People and places', 'Fantasy'];

export const ICONS: IconDef[] = [
  // Ships (seen from the side, bow to the right).
  {
    id: 'sailing-ship', name: 'Sailing ship', group: 'Ships', turn: 'mirror',
    solid: 'M3 35H15V39H59L53 51H12Z' + // hull with a raised stern
      'M18 12h2v28h-2ZM31 3h2v37h-2ZM44 10h2v30h-2Z' + // masts
      'M14 14H24Q25.5 18 24 22H14Q15.5 18 14 14ZM13.5 24H24.5Q26 28.5 24.5 33H13.5Q15 28.5 13.5 24Z' + // mizzen sails
      'M26.5 8H37.5Q39 13.5 37.5 19H26.5Q28 13.5 26.5 8ZM26 21H38Q39.5 27 38 33H26Q27.5 27 26 21Z' + // main sails
      'M40 12H49Q50.5 16.5 49 21H40Q41.5 16.5 40 12ZM39.5 23H49.5Q51 28 49.5 33H39.5Q41 28 39.5 23Z' + // fore sails
      'M47 13L60 35H51Z' + // jib
      'M57 39L63 31L64.5 32L59.5 39.5Z' + // bowsprit
      'M33 3L40 5L33 7Z', // pennant
    detail: 'M18 43h3v3h-3ZM26 43h3v3h-3ZM34 43h3v3h-3ZM42 43h3v3h-3ZM50 43h3v3h-3Z',
  },
  {
    id: 'galley', name: 'Galley', group: 'Ships', turn: 'mirror',
    solid: 'M2 33Q7 45 18 45H47Q58 45 63 32Q56 39 47 39H18Q8 39 2 33Z' + 'M31 9h2v30h-2Z' + 'M19 11H45Q47 20 45 29H19Q21 20 19 11Z',
    line: 'M20 43L13 56M28 43L21 56M36 43L29 56M44 43L37 56', lineWidth: 2,
  },
  {
    id: 'warship', name: 'Warship', group: 'Ships', turn: 'mirror',
    solid: 'M2 40H52L62 36L57 50H7Z' + // hull, raised bow
      'M23 40V32H27V24H31V17H35V24H38V32H42V40Z' + // bridge and tower
      'M43 40V29H48V40Z' + // funnel
      'M32.5 8h1.5v9h-1.5Z' + // mast
      'M48 40V35H56V40ZM55 35.5H63V37.5H55Z' + // fore turret and gun
      'M9 40V35H17V40ZM1 35.5H10V37.5H1Z', // aft turret and gun
    detail: 'M28 26h6v3h-6Z',
  },
  {
    id: 'carrier', name: 'Aircraft carrier', group: 'Ships', turn: 'mirror',
    solid: 'M1 35H63V40H1Z' + 'M6 40H59L55 50H11Z' + 'M40 35V23H48V35Z' + 'M43.5 15h1.5v8h-1.5Z' + 'M40 17H48V19H40Z',
    detail: 'M41 25h6v3h-6Z',
  },
  {
    id: 'submarine', name: 'Submarine', group: 'Ships', turn: 'mirror',
    solid: 'M7 40Q7 34 15 34H52Q62 34 62 40Q62 46 52 46H15Q7 46 7 40Z' +
      'M23 34V26Q23 24 25 24H34L37 34Z' + 'M28 24V15H30V24ZM28 15H34V17H28Z' + 'M1 33L9 38V42L1 47Z',
  },
  {
    id: 'freighter', name: 'Cargo ship', group: 'Ships', turn: 'mirror',
    solid: 'M2 38H62L57 50H8Z' + 'M6 38V22H16V38Z' + 'M5 20H17V23H5Z' + 'M8 20V14H13V20Z' +
      'M19 28H57V38H19Z' + 'M21 21H53V28H21Z',
    detail: 'M27 21h1v17h-1ZM35 21h1v17h-1ZM43 21h1v17h-1ZM51 28h1v10h-1ZM19 27.5H57V28.5H19Z' + 'M8 25h6v3h-6Z',
  },
  {
    id: 'tanker', name: 'Tanker', group: 'Ships', turn: 'mirror',
    solid: 'M2 36H62L58 50H7Z' + 'M5 36V21H14V36Z' + 'M4 19H15V22H4Z' + 'M7 19V13H11V19Z' +
      'M17 33H59V36H17Z' + 'M22 33a4 3 0 0 1 8 0ZM33 33a4 3 0 0 1 8 0ZM44 33a4 3 0 0 1 8 0Z' + 'M55 26h1.5v7h-1.5Z',
    detail: 'M6 42H59V44H6Z' + 'M7 24h5v3h-5Z',
  },
  {
    id: 'liner', name: 'Ocean liner', group: 'Ships', turn: 'mirror',
    solid: 'M2 34H62L57 50H8Z' + 'M9 34V27H55V34Z' + 'M15 27V21H49V27Z' +
      'M19 21L21 11H27L25 21ZM29 21L31 11H37L35 21ZM39 21L41 11H47L45 21Z',
    detail: circles([[11, 40], [17, 40], [23, 40], [29, 40], [35, 40], [41, 40], [47, 40], [53, 40]], 1.3) +
      'M12 29h40v2H12ZM18 23h28v2H18Z' + 'M19.5 14H27V16H19ZM29.5 14H37V16H29ZM39.5 14H47V16H39Z',
  },
  {
    id: 'boat', name: 'Boat', group: 'Ships', turn: 'mirror',
    solid: 'M6 40H60L52 51H14Z' + 'M30 40V29H45V40Z' + 'M19 12h2.5v28H19Z',
    detail: 'M33 31h9v4h-9Z',
    line: 'M20.5 15L10 38', lineWidth: 1.5,
  },
  // Aircraft (seen from above, nose up).
  {
    id: 'airliner', name: 'Airliner', group: 'Aircraft', turn: 'rotate',
    solid: 'M32 2Q35 2 35 8V50L33 62H31L29 50V8Q29 2 32 2Z' + 'M29 23L2 37V41L29 34Z' + 'M35 23L62 37V41L35 34Z' +
      'M11 28h4.5v9H11ZM48.5 28H53v9h-4.5Z' + 'M29 51L18 57V60L31 57Z' + 'M35 51L46 57V60L33 57Z',
  },
  {
    id: 'light-plane', name: 'Propeller plane', group: 'Aircraft', turn: 'rotate',
    solid: 'M30 8H34L35 30L33.5 58H30.5L29 30Z' + 'M3 18Q3 16 5 16H59Q61 16 61 18V25Q61 26 59 26H5Q3 26 3 25Z' + 'M21 52H43V57H21Z' + 'M22 5H42V7.5H22Z',
    detail: 'M30.5 11h3v4h-3Z',
  },
  {
    id: 'fighter', name: 'Fighter jet', group: 'Aircraft', turn: 'rotate',
    solid: 'M32 1L35 14V48L37 60H27L29 48V14Z' + 'M29 25L4 45V50L29 44Z' + 'M35 25L60 45V50L35 44Z' + 'M29 50L20 59V62L30 58Z' + 'M35 50L44 59V62L34 58Z',
    detail: 'M31 11Q32 7.5 33 11V18H31Z',
  },
  {
    id: 'bomber', name: 'Bomber', group: 'Aircraft', turn: 'rotate',
    solid: 'M30 5Q32 1 34 5L35 48L33 62H31L29 48Z' + 'M29 19L2 27V33L29 30Z' + 'M35 19L62 27V33L35 30Z' +
      'M9 19h4v10H9ZM18 16h4v10h-4ZM42 16h4v10h-4ZM51 19h4v10h-4Z' + 'M29 51L15 55V59L31 58Z' + 'M35 51L49 55V59L33 58Z',
    detail: 'M30.5 7h3v5h-3Z',
  },
  {
    id: 'transport-plane', name: 'Military transport', group: 'Aircraft', turn: 'rotate',
    solid: 'M28 8Q32 1 36 8L37 46L34 61H30L27 46Z' + 'M2 18H62V25H2Z' + 'M11 12h4v12h-4ZM20 12h4v12h-4ZM40 12h4v12h-4ZM49 12h4v12h-4Z' + 'M17 53H47V58H17Z',
  },
  {
    id: 'drone', name: 'Drone', group: 'Aircraft', turn: 'rotate',
    solid: 'M30 8Q32 2 34 8L35 50H29Z' + 'M2 23Q2 21.5 4 21.5H60Q62 21.5 62 23V26Q62 27.5 60 27.5H4Q2 27.5 2 26Z' + 'M29.5 47L19 56V59L31 53Z' + 'M34.5 47L45 56V59L33 53Z' + 'M25 57.5H39V60H25Z',
  },
  {
    id: 'helicopter', name: 'Helicopter', group: 'Aircraft', turn: 'rotate',
    solid: 'M32 15Q41 15 41 28Q41 39 32 42Q23 39 23 28Q23 15 32 15Z' + 'M30.8 40H33.2V59H30.8Z' + 'M25 56H39V58.5H25Z',
    detail: circle(32, 27, 3.2),
    line: 'M7 10L57 44M7 44L57 10', lineWidth: 2.6,
  },
  {
    id: 'airship', name: 'Airship', group: 'Aircraft', turn: 'mirror',
    solid: 'M3 28Q7 17 31 16Q59 16 62 28Q59 40 31 40Q7 39 3 28Z' + 'M6 22L1 11H10L15 20Z' + 'M6 34L1 45H10L15 36Z' + 'M25 40H41L38 47H28Z',
    detail: 'M30 42h2v3h-2ZM35 42h2v3h-2Z',
  },
  {
    id: 'missile', name: 'Missile', group: 'Aircraft', turn: 'rotate',
    solid: 'M32 2L36 13V47L42 55V60L36 56V58H28V56L22 60V55L28 47V13Z' + 'M28 25L23 32V35L28 33ZM36 25L41 32V35L36 33Z',
  },
  // On land (seen from the side, facing right).
  {
    id: 'tank', name: 'Tank', group: 'On land', turn: 'mirror',
    solid: 'M6 45Q6 39 12 39H52Q58 39 58 45Q58 51 52 51H12Q6 51 6 45Z' + 'M4 39L10 32H54L60 39Z' + 'M17 32L21 24H40L44 32Z' + 'M40 25.5H62V28.5H40Z',
    detail: circles([[13, 45], [21, 45], [29, 45], [37, 45], [45, 45], [52, 45]], 2.7),
  },
  {
    id: 'armoured-car', name: 'Armoured car', group: 'On land', turn: 'mirror',
    solid: 'M4 42V31L12 24H48L58 32V42Z' + 'M24 24V18H37V24Z' + 'M37 19.5H50V21.5H37Z' + circles([[15, 44], [31, 44], [48, 44]], 7),
    detail: circles([[15, 44], [31, 44], [48, 44]], 2.6) + 'M50 30h5l-3-4h-2Z',
  },
  {
    id: 'artillery', name: 'Artillery', group: 'On land', turn: 'mirror',
    solid: 'M17 37L58 18L60.5 23L19.5 42Z' + 'M22 44L5 55L7 58L26 47Z' + circle(25, 44, 12),
    detail: circle(25, 44, 9),
    top: circle(25, 44, 3),
    line: 'M25 35V53M16 44H34M18.6 37.6L31.4 50.4M18.6 50.4L31.4 37.6', lineWidth: 1.8,
  },
  {
    id: 'truck', name: 'Truck', group: 'On land', turn: 'mirror',
    solid: 'M4 42V23Q4 18 9 18H38V42Z' + 'M40 42V26H52L59 34V42Z' + 'M3 42H61V46H3Z' + circles([[13, 48], [26, 48], [50, 48]], 6),
    detail: 'M43 28h8l4.5 5H43Z' + circles([[13, 48], [26, 48], [50, 48]], 2.2) + 'M14 18h1.5v24H14ZM26 18h1.5v24H26Z',
  },
  {
    id: 'cavalry', name: 'Cavalry', group: 'On land', turn: 'mirror',
    solid: 'M14 31Q14 24 22 24H40Q46 24 46 31Q46 37 40 38H22Q14 37 14 31Z' + // body
      'M39 27L47 14L53 13L59 18L58 22L53 21L47 33Z' + 'M47 15L48.5 10L51 14Z' + // neck, head, ear
      'M40 35L42 51H45L44 35ZM44 34L49 50H52L47 33Z' + 'M18 34L14 51H17L23 36ZM23 36L22 51H25L27 37Z' + // legs
      'M14 27Q5 28 6 42Q9 35 15 31Z' + // tail
      'M27 25L28.5 13H34L35 25Z' + circle(31.3, 9, 3.6) + 'M30 23L33 33H36L33 22Z',
    line: 'M19 30L62 5', lineWidth: 2,
  },
  {
    id: 'army', name: 'Army', group: 'On land', turn: 'none',
    solid: circle(16, 20, 6) + 'M5 52V40Q5 30 16 30Q27 30 27 40V52Z' + circle(48, 20, 6) + 'M37 52V40Q37 30 48 30Q59 30 59 40V52Z' +
      'M10 0L13 7H7ZM54 0L57 7H51Z',
    detail: circle(32, 23, 9.5) + 'M16 62V47Q16 33 32 33Q48 33 48 47V62Z',
    top: circle(32, 23, 7.5) + 'M18 60V47Q18 35 32 35Q46 35 46 47V60Z',
    line: 'M10 6V30M54 6V30', lineWidth: 2,
  },
  {
    id: 'infantry', name: 'Infantry', group: 'On land', turn: 'mirror',
    solid: circle(31, 12, 5) + 'M24 11Q24 4 31 4Q38 4 38 11Z' + 'M25 18H36L38 37H23Z' + 'M23 37H29.5L28 59H22.5ZM31.5 37H38L40 59H34Z' + 'M35 19L42 29L39 31L33 23Z',
    line: 'M21 44L45 5', lineWidth: 2.6,
  },
  // Military signs.
  {
    id: 'hq', name: 'Headquarters', group: 'Military signs', turn: 'none',
    solid: 'M18 6H21.5V56H18Z' + 'M21.5 8H52L45 17.5L52 27H21.5Z' + 'M11 55H29V60H11Z',
  },
  {
    id: 'fort', name: 'Fort', group: 'Military signs', turn: 'none',
    solid: 'M6 58V18H14V24H22V18H30V24H34V18H42V24H50V18H58V58Z',
    detail: 'M25 58V47Q32 38 39 47V58Z' + 'M13 32h4v7h-4ZM47 32h4v7h-4Z',
  },
  {
    id: 'camp', name: 'Camp', group: 'Military signs', turn: 'none',
    solid: 'M3 56L32 10L61 56Z' + 'M31 4h2v8h-2ZM33 4L41 6.5L33 9Z',
    detail: 'M32 28L23 56H41Z',
  },
  {
    id: 'battle', name: 'Battle', group: 'Military signs', turn: 'none',
    solid: 'M14 47L48 9L54 7L52 13L18 51Z' + 'M50 47L16 9L10 7L12 13L46 51Z' +
      'M10 43L21 54L18.5 56.5L7.5 45.5ZM54 43L43 54L45.5 56.5L56.5 45.5Z' + 'M14 54L8 60L5.5 57.5L11.5 51.5ZM50 54L56 60L58.5 57.5L52.5 51.5Z',
  },
  {
    id: 'knight', name: 'Knight', group: 'Military signs', turn: 'none',
    solid: 'M14 56V26Q14 7 32 5Q50 7 50 26V56Q41 60 32 60Q23 60 14 56Z',
    detail: 'M17 27H47V31.5H17Z' + 'M30 31.5H34V56H30Z' + circles([[23, 41], [23, 47], [41, 41], [41, 47]], 1.6),
  },
  {
    id: 'shield', name: 'Shield', group: 'Military signs', turn: 'none',
    solid: 'M32 3L57 11V30Q57 50 32 61Q7 50 7 30V11Z',
    detail: 'M32 10L50 16V30Q50 45 32 54Q14 45 14 30V16Z',
    top: 'M29.5 15H34.5V51H29.5ZM17 26H47V31H17Z',
  },
  {
    id: 'star', name: 'Star', group: 'Military signs', turn: 'none',
    solid: 'M32 3L39.6 23.5L61.5 24.2L44.3 37.7L50.4 58.8L32 46.5L13.6 58.8L19.7 37.7L2.5 24.2L24.4 23.5Z',
  },
  {
    id: 'target', name: 'Target', group: 'Military signs', turn: 'none',
    solid: circle(32, 32, 24),
    detail: circle(32, 32, 19.5),
    top: circle(32, 32, 4),
    line: 'M32 2V22M32 42V62M2 32H22M42 32H62', lineWidth: 3,
  },
  {
    id: 'explosion', name: 'Explosion', group: 'Military signs', turn: 'none',
    solid: 'M32 2L37 20L50 6L45 23L62 19L49 31L63 41L45 40L52 58L37 45L32 62L27 45L12 58L19 40L1 41L15 31L2 19L19 23L14 6L27 20Z',
    detail: 'M32 17L35 27L43 22L39 31L48 34L39 37L42 46L34 41L32 50L30 41L22 46L25 37L16 34L25 31L21 22L29 27Z',
  },
  {
    id: 'parachute', name: 'Airborne', group: 'Military signs', turn: 'none',
    solid: 'M5 30Q5 7 32 7Q59 7 59 30Q52 25 45.5 30Q39 25 32 30Q25 25 18.5 30Q12 25 5 30Z' + 'M27 48H37V59H27Z',
    line: 'M6 30L30 49M18.5 30L31 49M45.5 30L33 49M58 30L34 49M32 30V48', lineWidth: 1.4,
  },
  {
    id: 'anchor', name: 'Naval base', group: 'Military signs', turn: 'none',
    solid: circle(32, 9, 6.5) + 'M29.5 15H34.5V57H29.5Z' + 'M19 20H45V25H19Z' +
      'M6 36L14 33L13 39Q17 52 32 53Q47 52 51 39L50 33L58 36L55.5 38Q52 58 32 59Q12 58 8.5 38Z',
    detail: circle(32, 9, 3),
  },
  {
    id: 'radar', name: 'Radar', group: 'Military signs', turn: 'none',
    solid: 'M10 14Q30 22 42 42Q32 50 16 44Q4 34 10 14Z' + 'M27 41L23 56H41L37 41Z' + 'M14 60H50V56H14Z',
    line: 'M17 31L34 18', lineWidth: 2.4,
    top: circle(35, 17, 3),
  },
  // People and places.
  {
    id: 'person', name: 'Person', group: 'People and places', turn: 'none',
    solid: circle(32, 16, 10) + 'M14 59V46Q14 30 32 30Q50 30 50 46V59Z',
  },
  {
    id: 'crown', name: 'Ruler', group: 'People and places', turn: 'none',
    solid: 'M6 48L9 15L21 32L32 9L43 32L55 15L58 48Z' + 'M6 50H58V58H6Z' + circles([[9, 13], [32, 7], [55, 13]], 3.5),
    detail: circles([[20, 54], [32, 54], [44, 54]], 2.2),
  },
  {
    id: 'train', name: 'Train', group: 'On land', turn: 'mirror',
    solid: 'M5 42V18H22V42Z' + 'M3 15H24V19H3Z' + 'M22 25H53Q60 25 60 33.5Q60 42 53 42H22Z' + 'M46 25V13H53V25Z' + 'M33 25Q33 19 37.5 19Q42 19 42 25Z' +
      'M57 42L63 52H52Z' + 'M3 42H60V46H3Z' + circles([[13, 51], [30, 51], [45, 51]], 6.5),
    detail: 'M9 21h9v8H9Z' + circles([[13, 51], [30, 51], [45, 51]], 2.4),
  },
  {
    id: 'car', name: 'Car', group: 'On land', turn: 'mirror',
    solid: 'M4 45V36Q4 32 10 31L19 30L27 22H44L52 30Q60 31 60 36V45Z' + circles([[17, 45], [48, 45]], 6.5),
    detail: 'M29 24.5H34.5V30H22.5ZM37 24.5H43L48 30H37Z' + circles([[17, 45], [48, 45]], 2.4),
  },
  {
    id: 'wagon', name: 'Wagon', group: 'People and places', turn: 'mirror',
    solid: 'M8 36V22Q8 12 18 12H34Q44 12 44 22V36Z' + 'M5 36H47V40H5Z' + circle(15, 47, 8.5) + circle(38, 47, 8.5),
    detail: circle(15, 47, 6) + circle(38, 47, 6) + 'M19 12h1.5v24H19ZM31 12h1.5v24H31Z',
    top: circle(15, 47, 2) + circle(38, 47, 2),
    line: 'M15 41V53M9 47H21M38 41V53M32 47H44M47 38L62 35', lineWidth: 1.6,
  },
  {
    id: 'camel', name: 'Caravan', group: 'People and places', turn: 'mirror',
    solid: 'M10 33Q11 22 20 21Q25 12 31 20Q37 13 42 22Q46 23 48 27L53 13H59L62 17L58 19L50 36Q48 38 44 38H15Q10 37 10 33Z' +
      'M14 36L12 59H15.5L19 37ZM20 37L20 59H23.5L24 37ZM40 37L40 59H43.5L45 37ZM45 36L48 59H51.5L49 35Z' + 'M10 30L5 41H8L12 33Z',
  },
  {
    id: 'envoy', name: 'Envoy', group: 'People and places', turn: 'none',
    solid: 'M5 15H59V50H5Z',
    detail: 'M7.5 17L32 35L56.5 17L58 19.5L32 39L6 19.5Z',
  },
  {
    id: 'trade', name: 'Trade', group: 'People and places', turn: 'none',
    solid: 'M23 18L18 9H46L41 18Q58 27 56 45Q54 58 32 58Q10 58 8 45Q6 27 23 18Z',
    detail: 'M20 18H44V22.5H20Z' + 'M30 29h4v22h-4Z' + 'M24 33Q24 28 32 28Q40 28 40 33H35.5Q35.5 31.5 32 31.5Q28.5 31.5 28.5 33.5Q28.5 35.5 32 36.5Q40 38 40 43.5Q40 49 32 49Q24 49 24 43.5H28.5Q28.5 45.5 32 45.5Q35.5 45.5 35.5 43.5Q35.5 41.5 32 40.5Q24 39 24 33Z',
  },
  {
    id: 'explorer', name: 'Explorer', group: 'People and places', turn: 'none',
    solid: circle(32, 32, 27),
    detail: circle(32, 32, 22.5),
    top: 'M32 11L38.5 32L32 53L25.5 32Z' + circle(32, 32, 2.5),
  },
  {
    id: 'flag', name: 'Flag', group: 'People and places', turn: 'none',
    solid: 'M12 4H16V60H12Z' + 'M16 7Q26 3 36 8Q46 13 55 8V35Q46 40 36 35Q26 30 16 34Z',
  },
  // Worlds of one's own (D179).
  {
    id: 'castle', name: 'Castle', group: 'Fantasy', turn: 'none',
    solid: 'M4 58V18H7V13H11V18H14V13H18V58Z' + 'M46 58V18H49V13H53V18H56V13H60V58Z' + 'M18 58V30H22V26H26V30H30V26H34V30H38V26H42V30H46V58Z' + 'M25 32V16H28V11H31V16H33V11H36V16H39V32Z' + 'M31.2 2h1.6v10h-1.6ZM32.8 2.5L40 5L32.8 7.5Z',
    detail: 'M27 58V49Q32 43 37 49V58Z' + 'M10 25h2.5v6h-2.5ZM51.5 25h2.5v6h-2.5ZM30.8 19h2.4v6h-2.4Z',
  },
  {
    id: 'tower', name: 'Tower', group: 'Fantasy', turn: 'none',
    solid: 'M23 60V24H41V60Z' + 'M19 26L32 2L45 26Z' + 'M18 60V55H46V60Z',
    detail: 'M29.5 31h5v7h-5ZM29.5 43h5v6h-5Z' + 'M28 60V55Q32 51 36 55V60Z',
    top: circle(32, 3, 2.4),
  },
  {
    id: 'wizard', name: 'Wizard', group: 'Fantasy', turn: 'none',
    solid: 'M23 21L33 2L41 21Z' + 'M15 21H49V25.5H15Z' + circle(32, 31, 6) + 'M17 60L23 38H41L47 60Z' + circle(52, 9, 4.5),
    detail: 'M31 41h2v19h-2Z',
    line: 'M52 13V61', lineWidth: 3,
  },
  {
    id: 'dragon', name: 'Dragon', group: 'Fantasy', turn: 'mirror',
    solid:
      'M17 41Q23 32 37 33Q46 34 49 40Q44 47 32 47Q21 47 17 41Z' + // body
      'M43 36Q48 27 52 21L58 17.5L63 19.5L61 22.5L56 23.5L54 25.5Q51 31 48 40Z' + // neck and head
      'M54 17.5L55.5 12.5L57.5 17Z' + // horn
      'M18 40Q10 41 5.5 47Q3 52 7.5 55.5Q5.5 51 9 48Q13 44.5 20 44Z' + // tail
      'M3.5 56.5L6.5 52.5L9 56Z' + // the tail's tip
      'M24 35L15 8L23 14L28 5L33 15L40 9L41 34Z' + // wing
      'M25 45L22.5 55H27L30 46Z' + 'M38 45L38.5 55H43L42 44Z', // legs
    detail: 'M18.6 12.6L25.4 33.5L24.4 33.8L17.6 12.9Z' + 'M27.6 8.2L30.4 33.6L29.4 33.7L26.6 8.3Z' + 'M37.8 12.2L36.2 33.6L35.2 33.5L36.8 12.1Z',
  },
];

const byId = new Map(ICONS.map((i) => [i.id, i]));

export function iconById(id: string | null | undefined): IconDef | undefined {
  return id ? byId.get(id) : undefined;
}

/**
 * How a character is drawn (D85): an icon of the set (the set below) or a picture of one's
 * own instead of the round marker; on a disc of its colour (badge) or as the icon itself in its colour
 * (plain); a size (times the project's size for characters); and whether it faces where it travels:
 * the icon's own way (auto: aircraft turn, ships and vehicles face east or west, signs stay), turned,
 * flipped east and west, or never.
 */
export interface CharacterIcon {
  set?: string;
  asset?: string;
  look?: 'badge' | 'plain';
  size?: number;
  turn?: 'auto' | 'rotate' | 'mirror' | 'none';
}

/** A character's icon as stored, checked: null for the round marker. */
export function cleanIcon(icon: CharacterIcon | null | undefined): CharacterIcon | null {
  if (!icon || typeof icon !== 'object') return null;
  const out: CharacterIcon = {};
  if (typeof icon.set === 'string' && iconById(icon.set)) out.set = icon.set;
  else if (typeof icon.asset === 'string' && /^[\w\-./]+$/.test(icon.asset) && !icon.asset.includes('..')) out.asset = icon.asset;
  else return null;
  if (icon.look === 'badge' || icon.look === 'plain') out.look = icon.look;
  if (typeof icon.size === 'number' && Number.isFinite(icon.size)) out.size = Math.min(3, Math.max(0.5, icon.size));
  if (icon.turn === 'rotate' || icon.turn === 'mirror' || icon.turn === 'none' || icon.turn === 'auto') out.turn = icon.turn;
  return out;
}


/** How a character's route is shown (D90): a trail of where it has been, or an arrow of advance along the way it is going. */
export type RouteStyle = 'trail' | 'arrow';

/** A character as a unit (D90): the country it belongs to (it takes that country's colour), and how its route is shown. */
export function unitOfStyle(style: string | null | undefined): { side: string | null; route: RouteStyle | null } {
  try {
    const st = style ? (JSON.parse(style) as { side?: unknown; route?: unknown } | null) : null;
    return { side: typeof st?.side === 'string' && st.side ? st.side : null, route: st?.route === 'trail' || st?.route === 'arrow' ? st.route : null };
  } catch { return { side: null, route: null }; }
}

/** A character's icon from its stored style (JSON): null for the round marker. */
export function iconOfStyle(style: string | null | undefined): CharacterIcon | null {
  if (!style) return null;
  try { return cleanIcon((JSON.parse(style) as { icon?: CharacterIcon } | null)?.icon); } catch { return null; }
}


// Paths made once per icon and part (browsers only: Path2D).
const paths = new Map<string, Path2D>();
function pathOf(icon: IconDef, part: 'solid' | 'detail' | 'top' | 'line'): Path2D | null {
  const d = icon[part];
  if (!d || typeof Path2D === 'undefined') return null;
  const key = `${icon.id}|${part}`;
  let p = paths.get(key);
  if (!p) { p = new Path2D(d); paths.set(key, p); }
  return p;
}

export interface IconDraw {
  /** The icon's colour. */
  color: string;
  /** The colour of its details (and of its outline when `halo` is given). */
  detail: string;
  /** An outline this wide (grid units) around the icon in the detail colour, so it stands out on any map. */
  halo?: number;
  /** Turned this far (radians, clockwise), and/or flipped to face west. */
  angle?: number;
  mirror?: boolean;
}

/** Draw an icon centred at x, y, `size` pixels across. */
export function drawIcon(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, icon: IconDef, x: number, y: number, size: number, o: IconDraw): void {
  const solid = pathOf(icon, 'solid'), detail = pathOf(icon, 'detail'), top = pathOf(icon, 'top'), line = pathOf(icon, 'line');
  if (!solid) return;
  const k = size / 64;
  ctx.save();
  ctx.translate(x, y);
  if (o.angle) ctx.rotate(o.angle);
  ctx.scale(o.mirror ? -k : k, k);
  ctx.translate(-32, -32);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (o.halo) {
    ctx.strokeStyle = o.detail;
    ctx.lineWidth = 2 * o.halo;
    ctx.stroke(solid);
    if (top) ctx.stroke(top);
    if (line) { ctx.lineWidth = 2 * o.halo + (icon.lineWidth ?? 2); ctx.stroke(line); }
  }
  ctx.fillStyle = o.color;
  ctx.fill(solid);
  if (detail) { ctx.fillStyle = o.detail; ctx.fill(detail); }
  ctx.fillStyle = o.color;
  if (top) ctx.fill(top);
  if (line) { ctx.strokeStyle = o.color; ctx.lineWidth = icon.lineWidth ?? 2; ctx.stroke(line); }
  ctx.restore();
}
