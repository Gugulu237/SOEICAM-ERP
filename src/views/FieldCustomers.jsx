import React from 'react';
import {Navigate,useSearchParams} from '@/lib/router';
export default function FieldCustomers(){const [params]=useSearchParams();return <Navigate to={'/customers'+(params.toString()?'?'+params.toString():'')} replace/>;}
