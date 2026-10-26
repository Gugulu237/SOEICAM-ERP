import React from 'react';
import {useLocaleRender} from '@/lib/localization';
import AssemblyComponents from '@/components/items/AssemblyComponents';
export default function AssemblyFields(props) {
  useLocaleRender();
  return <AssemblyComponents {...props}/>;
}
