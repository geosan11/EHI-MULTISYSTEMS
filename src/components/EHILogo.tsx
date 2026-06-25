export const EHILogo = ({ className, width, height }: { className?: string, width?: number | string, height?: number | string }) => (
  <svg 
    viewBox="0 0 400 300" 
    width={width || "100%"} 
    height={height || "100%"} 
    className={className}
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Left Gold Swoosh */}
    <path 
      d="M 180 140 C 140 140 90 110 70 95 C 110 115 150 160 170 170 Z" 
      fill="#F59E0B" 
    />
    {/* Right Blue Swoosh */}
    <path 
      d="M 170 170 C 190 120 250 80 350 70 C 290 90 220 130 180 180 Z" 
      fill="#025AAA" 
    />

    {/* EHI Text */}
    <text 
      x="210" 
      y="240" 
      fontFamily="Inter, Arial, sans-serif" 
      fontWeight="900" 
      fontSize="110" 
      fill="#025AAA" 
      textAnchor="middle" 
      letterSpacing="2"
    >
      EHI
    </text>
    
    {/* MULTISYSTEMS box */}
    <rect 
      x="95" 
      y="255" 
      width="230" 
      height="30" 
      fill="#F59E0B" 
    />
    <text 
      x="210" 
      y="277" 
      fontFamily="Inter, Arial, sans-serif" 
      fontWeight="bold" 
      fontSize="19" 
      fill="#000000" 
      textAnchor="middle" 
      letterSpacing="1"
    >
      MULTISYSTEMS
    </text>

    {/* NIGERIA LIMITED */}
    <text 
      x="210" 
      y="315" 
      fontFamily="Inter, Arial, sans-serif" 
      fontWeight="800" 
      fontSize="20" 
      fill="#000000" 
      textAnchor="middle" 
      letterSpacing="4"
    >
      NIGERIA LIMITED
    </text>
  </svg>
);
