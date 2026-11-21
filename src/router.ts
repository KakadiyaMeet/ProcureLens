// Generouted, changes to this file will be overridden
/* eslint-disable */

import { components, hooks, utils } from '@generouted/react-router/client'

export type Path =
  | `*`
  | `/`
  | `/analyst`
  | `/api-status`
  | `/comparisons`
  | `/home`
  | `/onboarding`
  | `/purchase-requests`
  | `/quotation-import`
  | `/settings`
  | `/suppliers`

export type Params = {
  '/*': { '*': string }
}

export type ModalPath = never

export const { Link, Navigate } = components<Path, Params>()
export const { useModals, useNavigate, useParams } = hooks<Path, Params, ModalPath>()
export const { redirect } = utils<Path, Params>()
