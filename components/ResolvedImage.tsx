import React, { useEffect, useState } from 'react';
import { getImageBlobByRef, isImageRef } from '../utils/imageStorage';

type ResolvedImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src?: string | null;
  fallbackSrc?: string;
};

const ResolvedImage: React.FC<ResolvedImageProps> = ({ src, fallbackSrc, ...imgProps }) => {
  const [resolvedSrc, setResolvedSrc] = useState<string>(fallbackSrc || '');

  useEffect(() => {
    let isCancelled = false;
    let objectUrl = '';

    const resolveSrc = async () => {
      const source = src?.trim();
      if (!source) {
        setResolvedSrc(fallbackSrc || '');
        return;
      }

      if (!isImageRef(source)) {
        setResolvedSrc(source);
        return;
      }

      try {
        const blob = await getImageBlobByRef(source);
        if (!blob || isCancelled) {
          setResolvedSrc(fallbackSrc || '');
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        setResolvedSrc(objectUrl);
      } catch {
        if (!isCancelled) setResolvedSrc(fallbackSrc || '');
      }
    };

    resolveSrc();

    return () => {
      isCancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, fallbackSrc]);

  if (!resolvedSrc) return null;
  return <img {...imgProps} src={resolvedSrc} />;
};

export default ResolvedImage;

