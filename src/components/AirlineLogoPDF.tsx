import { View, Text, Image } from '@react-pdf/renderer';
import aeroLogo from '../assets/airlines/aero-contractors.png';
import valuejetLogo from '../assets/airlines/valuejet.png';
import unitedNigeriaLogo from '../assets/airlines/united-nigeria.png';
import arikLogo from '../assets/airlines/arik-air.png';
import greenAfricaLogo from '../assets/airlines/green-africa.png';

export const AirlineLogoPDF = ({ airline, width = 80 }: { airline: string; width?: number }) => {
  const norm = airline.toLowerCase();

  if (norm.includes('aero')) {
    return (
      <View style={{ width, alignItems: 'center' }}>
        <Image src={aeroLogo} style={{ width, height: width * 0.400 }} />
      </View>
    );
  }

  if (norm.includes('arik')) {
    return (
      <View style={{ width, alignItems: 'center' }}>
        <Image src={arikLogo} style={{ width, height: width * 0.426 }} />
      </View>
    );
  }

  if (norm.includes('valuejet')) {
    return (
      <View style={{ width, alignItems: 'center' }}>
        <Image src={valuejetLogo} style={{ width, height: width * 0.708 }} />
      </View>
    );
  }

  if (norm.includes('united') || norm.includes('un')) {
    return (
      <View style={{ width, alignItems: 'center' }}>
        <Image src={unitedNigeriaLogo} style={{ width, height: width * 0.422 }} />
      </View>
    );
  }

  if (norm.includes('green africa') || norm.includes('greenafrica')) {
    return (
      <View style={{ width, alignItems: 'center' }}>
        <Image src={greenAfricaLogo} style={{ width, height: width * 0.185 }} />
      </View>
    );
  }

  // Fallback for any airline without a logo file yet
  return (
    <View style={{ width, alignItems: 'center' }}>
      <Text style={{ fontSize: width * 0.15, color: '#000000', fontWeight: 700, textAlign: 'center' }}>{airline.toUpperCase()}</Text>
    </View>
  );
};
