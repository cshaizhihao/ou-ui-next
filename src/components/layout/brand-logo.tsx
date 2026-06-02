import catLogo from '../../assets/cat-logo.png';
import { cn } from '../../lib/cn';

type BrandLogoProps = {
  size?: 'lg' | 'sm';
  className?: string;
};

export function BrandLogo({ size = 'sm', className }: BrandLogoProps) {
  const dimensions = size === 'lg' ? 'h-20 w-20' : 'h-7 w-7';

  return <img src={catLogo} alt="OU-UI Next Logo" className={cn(dimensions, 'logo-cat object-contain', className)} />;
}
