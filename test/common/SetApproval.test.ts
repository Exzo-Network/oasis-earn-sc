import BigNumber from 'bignumber.js'
import { expect } from 'chai'
import { Contract } from 'ethers'
import { ethers } from 'hardhat'

import IERC20_ABI from '../../abi/IERC20.json'
import { ADDRESSES } from '../../helpers/addresses'
import { createDeploy, DeployFunction } from '../../helpers/deploy'
import init, { resetNode } from '../../helpers/init'
import { calldataTypes } from '../../helpers/types/actions'
import { RuntimeConfig } from '../../helpers/types/common'
import { amountToWei } from '../../helpers/utils'

describe('SetApproval Action', () => {
  const BLOCK_NUMBER = 14798701
  const AMOUNT = new BigNumber(1000)
  let config: RuntimeConfig
  let deploy: DeployFunction
  let approval: Contract
  let approvalActionAddress: string

  before(async () => {
    config = await init()
    deploy = await createDeploy({ config, debug: false })
  })

  beforeEach(async () => {
    await resetNode(config.provider, BLOCK_NUMBER)
    const deployed = await deploy('SetApproval', [])
    approval = deployed[0]
    approvalActionAddress = deployed[1]
  })

  it('should set approval', async () => {
    await approval.execute(
      ethers.utils.defaultAbiCoder.encode(
        [calldataTypes.common.Approval],
        [
          {
            asset: ADDRESSES.main.DAI,
            delegator: config.address,
            amount: amountToWei(AMOUNT).toFixed(0),
          },
        ],
      ),
      [],
    )

    const DAI = new ethers.Contract(ADDRESSES.main.DAI, IERC20_ABI, config.signer)

    const allowance = await DAI.allowance(approvalActionAddress, config.address)

    expect(allowance.toString()).to.equal(amountToWei(AMOUNT).toFixed(0))
  })
})