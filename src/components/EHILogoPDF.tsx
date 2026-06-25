import { Svg, Path, Rect, Text } from '@react-pdf/renderer';

export const EHILogoPDF = ({ width = 120 }: { width?: number }) => (
  <Svg viewBox="0 0 400 350" width={width} height={width * (350 / 400)}>
    {/* Left Gold Swoosh */}
    <Path d="M 180 140 C 140 140 90 110 70 95 C 110 115 150 160 170 170 Z" fill="#F59E0B" />
    {/* Right Blue Swoosh */}
    <Path d="M 170 170 C 190 120 250 80 350 70 C 290 90 220 130 180 180 Z" fill="#025AAA" />

    {/* EHI Text */}
    <Text x="210" y="240" fontSize="110" fill="#025AAA" textAnchor="middle">
      EHI
    </Text>
    
    {/* MULTISYSTEMS box */}
    <Rect x="95" y="255" width="230" height="30" fill="#F59E0B" />
    <Text x="210" y="277" fontSize="19" fill="#000000" textAnchor="middle">
      MULTISYSTEMS
    </Text>

    {/* NIGERIA LIMITED */}
    <Text x="210" y="315" fontSize="20" fill="#000000" textAnchor="middle">
      NIGERIA LIMITED
    </Text>
  </Svg>
);
