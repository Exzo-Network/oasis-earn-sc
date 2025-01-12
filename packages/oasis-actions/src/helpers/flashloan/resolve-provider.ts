import { Network } from '../../../../../helpers/network'
import { FlashloanProvider } from '../../types/common'

export function resolveFlashloanProvider(network: Network): FlashloanProvider {
  switch (network) {
    case Network.MAINNET:
    case Network.GOERLI:
      return FlashloanProvider.DssFlash
    case Network.OPT_MAINNET:
      return FlashloanProvider.Balancer
    default:
      throw new Error(`Unsupported network ${network}`)
  }
}
