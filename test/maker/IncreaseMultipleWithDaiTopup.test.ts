/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { JsonRpcProvider } from '@ethersproject/providers'
import BigNumber from 'bignumber.js'
import { expect } from 'chai'
import { Contract, Signer } from 'ethers'
import { ethers } from 'hardhat'

import CDPManagerABI from '../../abi/dss-cdp-manager.json'
import ERC20ABI from '../../abi/IERC20.json'
import { ADDRESSES } from '../../helpers/addresses'
import { CONTRACT_NAMES, OPERATION_NAMES } from '../../helpers/constants'
import { executeThroughProxy } from '../../helpers/deploy'
import { gasEstimateHelper } from '../../helpers/gasEstimation'
import init, { resetNode } from '../../helpers/init'
import { getOraclePrice } from '../../helpers/maker/oracle'
import { getLastVault, getVaultInfo } from '../../helpers/maker/vault'
import {
  calculateParamsIncreaseMP,
  prepareMultiplyParameters,
} from '../../helpers/paramCalculations'
import { calldataTypes } from '../../helpers/types/actions'
import { ActionCall, RuntimeConfig, SwapData } from '../../helpers/types/common'
import { ActionFactory, amountToWei, ensureWeiFormat, ServiceRegistry } from '../../helpers/utils'
import { DeployedSystemInfo, deploySystem } from '../deploySystem'
import { expectToBeEqual } from '../utils'

const LENDER_FEE = new BigNumber(0)

const createAction = ActionFactory.create

let DAI: Contract
let WETH: Contract

describe(`Operations | Maker | ${OPERATION_NAMES.maker.INCREASE_MULTIPLE_WITH_DAI_TOP_UP}`, async () => {
  const oazoFee = 2 // divided by base (10000), 1 = 0.01%;
  const oazoFeePct = new BigNumber(oazoFee).div(10000)
  const flashLoanFee = LENDER_FEE
  const slippage = new BigNumber(0.0001) // percentage

  let provider: JsonRpcProvider
  let signer: Signer
  let address: string
  let system: DeployedSystemInfo
  let exchangeDataMock: { to: string; data: number }
  let registry: ServiceRegistry
  let config: RuntimeConfig

  before(async () => {
    config = await init()
    provider = config.provider
    signer = config.signer
    address = config.address

    DAI = new ethers.Contract(ADDRESSES.main.DAI, ERC20ABI, provider).connect(signer)
    WETH = new ethers.Contract(ADDRESSES.main.WETH, ERC20ABI, provider).connect(signer)

    const blockNumber = 13274574
    await resetNode(provider, blockNumber)

    const { system: _system, registry: _registry } = await deploySystem(config)
    system = _system
    registry = _registry

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    config = { provider, signer, address }

    exchangeDataMock = {
      to: system.common.exchange.address,
      data: 0,
    }

    oraclePrice = await getOraclePrice(provider)

    await system.common.exchange.setPrice(ADDRESSES.main.WETH, amountToWei(marketPrice).toFixed(0))
  })

  let oraclePrice: BigNumber
  const marketPrice = new BigNumber(2900)
  const initialColl = new BigNumber(100)
  const initialDebt = new BigNumber(0)
  const daiTopUp = new BigNumber(20000)
  const collTopUp = new BigNumber(0)
  const requiredCollRatio = new BigNumber(5)
  const gasEstimates = gasEstimateHelper()

  const testName = `should open vault, deposit ETH and increase multiple & [+DAI topup]`
  it(testName, async () => {
    await WETH.approve(
      system.common.userProxyAddress,
      amountToWei(initialColl.plus(collTopUp)).toFixed(0),
    )

    await DAI.approve(system.common.userProxyAddress, amountToWei(daiTopUp).toFixed(0))

    const { requiredDebt, additionalCollateral, preIncreaseMPTopUp } = calculateParamsIncreaseMP({
      oraclePrice,
      marketPrice,
      oazoFee: oazoFeePct,
      flashLoanFee,
      currentColl: initialColl,
      currentDebt: initialDebt,
      daiTopUp,
      collTopUp,
      requiredCollRatio,
      slippage,
    })

    const desiredCdpState = {
      requiredDebt,
      toBorrowCollateralAmount: additionalCollateral,
      daiTopUp,
      fromTokenAmount: requiredDebt.plus(daiTopUp),
      toTokenAmount: additionalCollateral,
      collTopUp,
    }

    const { exchangeData } = prepareMultiplyParameters({
      oneInchPayload: exchangeDataMock,
      desiredCdpState,
      fundsReceiver: address,
      skipFL: false,
    })

    const openVaultAction = createAction(
      await registry.getEntryHash(CONTRACT_NAMES.maker.OPEN_VAULT),
      [calldataTypes.maker.Open],
      [
        {
          joinAddress: ADDRESSES.main.maker.joinETH_A,
          mcdManager: ADDRESSES.main.maker.cdpManager,
        },
      ],
    )

    const pullTokenIntoProxyAction = createAction(
      await registry.getEntryHash(CONTRACT_NAMES.common.PULL_TOKEN),
      [calldataTypes.common.PullToken, calldataTypes.paramsMap],
      [
        {
          from: config.address,
          asset: ADDRESSES.main.WETH,
          amount: new BigNumber(ensureWeiFormat(initialColl)).toFixed(0),
        },
        [0],
      ],
    )

    const initialDepositAction = createAction(
      await registry.getEntryHash(CONTRACT_NAMES.maker.DEPOSIT),
      [calldataTypes.maker.Deposit, calldataTypes.paramsMap],
      [
        {
          joinAddress: ADDRESSES.main.maker.joinETH_A,
          mcdManager: ADDRESSES.main.maker.cdpManager,
          vaultId: 0,
          amount: ensureWeiFormat(initialColl),
        },
        [1],
      ],
    )

    const transferDaiTopupToProxyAction = createAction(
      await registry.getEntryHash(CONTRACT_NAMES.common.PULL_TOKEN),
      [calldataTypes.common.PullToken, calldataTypes.paramsMap],
      [
        {
          asset: DAI.address,
          from: address,
          amount: ensureWeiFormat(desiredCdpState.daiTopUp),
        },
        [0],
      ],
    )

    // Generate DAI -> Swap for collateral -> Deposit collateral
    const generateDaiForSwap = createAction(
      await registry.getEntryHash(CONTRACT_NAMES.maker.GENERATE),
      [calldataTypes.maker.Generate, calldataTypes.paramsMap],
      [
        {
          to: system.common.userProxyAddress,
          mcdManager: ADDRESSES.main.maker.cdpManager,
          vaultId: 0,
          amount: ensureWeiFormat(desiredCdpState.requiredDebt),
        },
        [1],
      ],
    )

    const swapAmount = new BigNumber(exchangeData.fromTokenAmount)
      .plus(ensureWeiFormat(desiredCdpState.daiTopUp))
      .toFixed(0)

    const swapData: SwapData = {
      fromAsset: exchangeData.fromTokenAddress,
      toAsset: exchangeData.toTokenAddress,
      // Add daiTopup amount to swap
      amount: swapAmount,
      receiveAtLeast: exchangeData.minToTokenAmount,
      withData: exchangeData._exchangeCalldata,
    }

    await DAI.approve(system.common.userProxyAddress, swapAmount)
    const swapAction = createAction(
      await registry.getEntryHash(CONTRACT_NAMES.test.DUMMY_SWAP),
      [calldataTypes.common.Swap],
      [swapData],
    )

    const collateralToDeposit = desiredCdpState.toBorrowCollateralAmount.plus(
      desiredCdpState.collTopUp,
    )
    const depositBorrowedCollateral = createAction(
      await registry.getEntryHash(CONTRACT_NAMES.maker.DEPOSIT),
      [calldataTypes.maker.Deposit, calldataTypes.paramsMap],
      [
        {
          joinAddress: ADDRESSES.main.maker.joinETH_A,
          mcdManager: ADDRESSES.main.maker.cdpManager,
          vaultId: 0,
          amount: ensureWeiFormat(collateralToDeposit),
        },
        [1],
      ],
    )

    const actions: ActionCall[] = [
      openVaultAction,
      pullTokenIntoProxyAction,
      initialDepositAction,
      transferDaiTopupToProxyAction,
      generateDaiForSwap,
      swapAction,
      depositBorrowedCollateral,
    ]

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_, txReceipt] = await executeThroughProxy(
      system.common.userProxyAddress,
      {
        address: system.common.operationExecutor.address,
        calldata: system.common.operationExecutor.interface.encodeFunctionData('executeOp', [
          actions,
          OPERATION_NAMES.maker.INCREASE_MULTIPLE_WITH_DAI_TOP_UP,
        ]),
      },
      signer,
    )

    gasEstimates.save(testName, txReceipt)

    const vault = await getLastVault(provider, signer, system.common.userProxyAddress)
    const info = await getVaultInfo(system.maker.mcdView, vault.id, vault.ilk)
    const currentCollRatio = info.coll.times(oraclePrice).div(info.debt)

    expectToBeEqual(currentCollRatio, requiredCollRatio, 3)

    const expectedColl = additionalCollateral.plus(initialColl).plus(preIncreaseMPTopUp)
    const expectedDebt = desiredCdpState.requiredDebt

    expect(info.coll.toFixed(0)).to.equal(expectedColl.toFixed(0))
    expect(info.debt.toFixed(0)).to.equal(expectedDebt.toFixed(0))

    const cdpManagerContract = new ethers.Contract(
      ADDRESSES.main.maker.cdpManager,
      CDPManagerABI,
      provider,
    ).connect(signer)
    const vaultOwner = await cdpManagerContract.owns(vault.id)
    expectToBeEqual(vaultOwner, system.common.userProxyAddress)
  })

  after(() => {
    gasEstimates.print()
  })
})