import { Image } from '@react-pdf/renderer';
import ehiLogo from '../assets/branding/ehi-logo.png';

export const EHILogoPDF = ({ width = 120 }: { width?: number }) => (
  <Image src={ehiLogo} style={{ width, height: width * 0.88 }} />
);
