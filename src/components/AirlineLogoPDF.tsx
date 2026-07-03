import { View, Text, Image } from '@react-pdf/renderer';
import aeroLogo from '../assets/airlines/aero-contractors.png';
import valuejetLogo from '../assets/airlines/valuejet.png';
import unitedNigeriaLogo from '../assets/airlines/united-nigeria.png';
import arikLogo from '../assets/airlines/arik-air.png';
import greenAfricaLogo from '../assets/airlines/green-africa.png';

export const AirlineLogoPDF = ({ airline, width = 80 }: { airline: string; width?: number }) => {
  const norm = airline.toLowerCase();

  // Fixed box for every airline, regardless of that logo's own aspect
  // ratio. Previously each branch computed its own height from its own
  // ratio, so the slot's rendered height varied by airline and could
  // shift surrounding layout. Now every airline gets the identical box;
  // objectFit:'contain' fits each logo inside it without distorting it.
  // A wide logo and a tall one will naturally fill different proportions
  // of that same box -- that's correct, not a bug.
  const boxHeight = width * 0.5;
  const boxStyle = { width, height: boxHeight, alignItems: 'center' as const, justifyContent: 'center' as const };
  const imgStyle = { width, height: boxHeight, objectFit: 'contain' as const };

  if (norm.includes('aero')) {
    return (
      <View style={boxStyle}>
        <Image src={aeroLogo} style={imgStyle} />
      </View>
    );
  }

  if (norm.includes('arik')) {
    return (
      <View style={boxStyle}>
        <Image src={arikLogo} style={imgStyle} />
      </View>
    );
  }

  if (norm.includes('valuejet')) {
    return (
      <View style={boxStyle}>
        <Image src={valuejetLogo} style={imgStyle} />
      </View>
    );
  }

  if (norm.includes('united') || norm.includes('un')) {
    return (
      <View style={boxStyle}>
        <Image src={unitedNigeriaLogo} style={imgStyle} />
      </View>
    );
  }

  if (norm.includes('green africa') || norm.includes('greenafrica')) {
    return (
      <View style={boxStyle}>
        <Image src={greenAfricaLogo} style={imgStyle} />
      </View>
    );
  }

  // Fallback for any airline without a logo file yet -- same fixed box,
  // so an unmatched airline doesn't shift layout either.
  return (
    <View style={boxStyle}>
      <Text style={{ fontSize: width * 0.15, color: '#000000', fontWeight: 700, textAlign: 'center' }}>{airline.toUpperCase()}</Text>
    </View>
  );
};
