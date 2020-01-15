const { assertBn } = require('@aragon/court/test/helpers/asserts/assertBn')
const { assertRevert } = require('@aragon/court/test/helpers/asserts/assertThrow')
//const { buildHelper } = require('@aragon/court/test/helpers/wrappers/court')(web3, artifacts)
const { DEFAULTS } = require('@aragon/court/test/helpers/wrappers/court')(web3, artifacts)
const { bn, bigExp } = require('@aragon/court/test/helpers/lib/numbers')

const { deploy } = require('./helpers/deploy')

const ERC20 = artifacts.require('ERC20Mock')
const ERC20Bad = artifacts.require('ERC20BadMock')
const UniswapExchange = artifacts.require('UniswapExchangeMock')
const CourtPresaleActivate = artifacts.require('CourtPresaleActivate')

contract('Court presale and activate wrapper', ([_, owner, juror1, juror2, juror3]) => {
  let collateralToken, bondedToken, registry, presale, uniswapFactory

  const ZERO_ADDRESS = '0x' + '0'.repeat(40)

  const ERROR_TOKEN_NOT_CONTRACT = 'CPA_TOKEN_NOT_CONTRACT'
  const ERROR_REGISTRY_NOT_CONTRACT = 'CPA_REGISTRY_NOT_CONTRACT'
  const ERROR_PRESALE_NOT_CONTRACT = 'CPA_PRESALE_NOT_CONTRACT'
  const ERROR_UNISWAP_FACTORY_NOT_CONTRACT = 'CPA_UNISWAP_FACTORY_NOT_CONTRACT'
  const ERROR_ZERO_AMOUNT = 'CPA_ZERO_AMOUNT'
  const ERROR_WRONG_TOKEN = 'CPA_WRONG_TOKEN'
  const ERROR_TOKEN_TRANSFER_FAILED = 'CPA_TOKEN_TRANSFER_FAILED'
  const ERROR_TOKEN_APPROVAL_FAILED = 'CPA_TOKEN_APPROVAL_FAILED'

  const INITIAL_BIG_TOKEN_AMOUNT = bigExp(1, 24)
  const exchangeRate = bn(200)
  const PPM = bn(1000000)

  before('Deploy token, registry and presale', async () => {
    ({ collateralToken, bondedToken, registry, presale, uniswapFactory } = await deploy(owner, exchangeRate))
    await collateralToken.mint(juror1, INITIAL_BIG_TOKEN_AMOUNT)
  })

  context('Deployment fails', () => {
    it('fails when bonded token is empty address', async () => {
      await assertRevert(CourtPresaleActivate.new(ZERO_ADDRESS, registry.address, presale.address, uniswapFactory.address), ERROR_TOKEN_NOT_CONTRACT)
    })

    it('fails when registry is empty address', async () => {
      await assertRevert(CourtPresaleActivate.new(bondedToken.address, ZERO_ADDRESS, presale.address, uniswapFactory.address), ERROR_REGISTRY_NOT_CONTRACT)
    })

    it('fails when presale is empty address', async () => {
      await assertRevert(CourtPresaleActivate.new(bondedToken.address, registry.address, ZERO_ADDRESS, uniswapFactory.address), ERROR_PRESALE_NOT_CONTRACT)
    })

    it('fails when uniswapFactory is empty address', async () => {
      await assertRevert(CourtPresaleActivate.new(bondedToken.address, registry.address, presale.address, ZERO_ADDRESS), ERROR_UNISWAP_FACTORY_NOT_CONTRACT)
    })
  })

  context('Succesfully deployed', () => {
    let cpa

    beforeEach('Deploy airdrop contract', async () => {
      // deploy
      cpa = await CourtPresaleActivate.new(bondedToken.address, registry.address, presale.address, uniswapFactory.address, { from: owner })
    })

    context('Bonded token', () => {
      it('fails when amount is zero', async () => {
        await assertRevert(collateralToken.approveAndCall(cpa.address, 0, '0x00'), ERROR_ZERO_AMOUNT)
      })

      it('buys, stakes and activates, using ApproveAndCall fallback', async () => {
        const amount = DEFAULTS.minActiveBalance.mul(PPM).div(exchangeRate)
        const initialActiveAmount = (await registry.balanceOf(juror1))[0]
        const bondedTokensToGet = await presale.contributionToTokens(amount);

        await collateralToken.approveAndCall(cpa.address, amount, '0x00', { from: juror1 })

        const finalActiveAmount = (await registry.balanceOf(juror1))[0]
        assertBn(finalActiveAmount, initialActiveAmount.add(bondedTokensToGet), `Active balance `)
      })

      it('buys, stakes and activates, in two transactions', async () => {
        const amount = DEFAULTS.minActiveBalance.mul(PPM).div(exchangeRate)
        const initialActiveAmount = (await registry.balanceOf(juror1))[0]
        const bondedTokensToGet = await presale.contributionToTokens(amount);

        await collateralToken.approve(cpa.address, amount, { from: juror1 })
        await cpa.receiveApproval(juror1, amount, collateralToken.address, '0x00', { from: juror1 })

        const finalActiveAmount = (await registry.balanceOf(juror1))[0]
        assertBn(finalActiveAmount, initialActiveAmount.add(bondedTokensToGet), `Active balance `)
      })

      it('fails in receive approval with wrong token', async () => {
        const amount = DEFAULTS.minActiveBalance.mul(PPM).div(exchangeRate)

        await bondedToken.approve(cpa.address, amount, { from: juror1 })
        await assertRevert(cpa.receiveApproval(juror1, amount, bondedToken.address, '0x00', { from: juror1 }), ERROR_WRONG_TOKEN)
      })
    })

    context('Using Uniswap', () => {
      let uniswapExchange

      beforeEach('mint tokens for Uniswap mock', async () => {
        const uniswapExchangeAddress = await uniswapFactory.getExchange(collateralToken.address)
        uniswapExchange = await UniswapExchange.at(uniswapExchangeAddress)
        await collateralToken.mint(uniswapExchangeAddress, INITIAL_BIG_TOKEN_AMOUNT)
      })

      context('External token', () => {
        let externalToken

        beforeEach('deploy external token, mint and approve', async () => {
          externalToken = await ERC20.new('External Token', 'ET', 18)
          await externalToken.mint(juror1, INITIAL_BIG_TOKEN_AMOUNT)
        })

        it('fails when amount is zero', async () => {
          await assertRevert(cpa.contributeExternalToken(externalToken.address, juror1, 0, 1, 1, 0), ERROR_ZERO_AMOUNT)
        })

        it('buys, stakes and activates', async () => {
          const externalExchangeRate = bn(500000)
          await uniswapExchange.setExchangeRate(externalToken.address, externalExchangeRate)
          const collateralAmount = DEFAULTS.minActiveBalance.mul(PPM).div(exchangeRate)
          const externalAmount = collateralAmount.mul(PPM).div(externalExchangeRate)
          const initialActiveAmount = (await registry.balanceOf(juror1))[0]
          const bondedTokensToGet = await presale.contributionToTokens(collateralAmount);

          await externalToken.approve(cpa.address, externalAmount, { from: juror1 })
          await cpa.contributeExternalToken(externalToken.address, juror1, externalAmount, 1, 1, 0, { from: juror1 })

          const finalActiveAmount = (await registry.balanceOf(juror1))[0]
          assertBn(finalActiveAmount, initialActiveAmount.add(bondedTokensToGet), `Active balance `)
        })
      })

      context('ETH', () => {
        const ETH = '0x' + '0'.repeat(40)

        it('fails when amount is zero', async () => {
          await assertRevert(cpa.contributeEth(1, 0, { from: juror1, value: 0 }), ERROR_ZERO_AMOUNT)
        })

        it('buys, stakes and activates', async () => {
          const ethExchangeRate = bn(50000000000)
          await uniswapExchange.setExchangeRate(ETH, ethExchangeRate)
          const collateralAmount = DEFAULTS.minActiveBalance.mul(PPM).div(exchangeRate)
          const ethAmount = collateralAmount.mul(PPM).div(ethExchangeRate)
          const initialActiveAmount = (await registry.balanceOf(juror1))[0]
          const bondedTokensToGet = await presale.contributionToTokens(collateralAmount);

          await cpa.contributeEth(1, 0, { from: juror1, value: ethAmount })

          const finalActiveAmount = (await registry.balanceOf(juror1))[0]
          assertBn(finalActiveAmount, initialActiveAmount.add(bondedTokensToGet), `Active balance `)
        })
      })
    })
  })

  context('Bad tokens', () => {
    let cpa, badCollateralToken, badExternalToken

    beforeEach('Deploy airdrop contract', async () => {
      // deploy bad tokens
      badCollateralToken = await ERC20Bad.new('Collateral Bad Token', 'BCT', 18)
      await badCollateralToken.mint(juror1, INITIAL_BIG_TOKEN_AMOUNT)
      badExternalToken = await ERC20Bad.new('External Token', 'ET', 18)
      await badExternalToken.mint(juror1, INITIAL_BIG_TOKEN_AMOUNT)

      // add it to Presale
      await presale.setCollateralToken(badCollateralToken.address)

      // deploy wrapper
      cpa = await CourtPresaleActivate.new(badCollateralToken.address, registry.address, presale.address, uniswapFactory.address, { from: owner })
    })

    it('receive approval fails if collateral token transfer fails', async () => {
      const amount = DEFAULTS.minActiveBalance.mul(PPM).div(exchangeRate)

      // make token misbehave
      await badCollateralToken.setTransferMisbehave(true)

      await assertRevert(badCollateralToken.approveAndCall(cpa.address, amount, '0x00', { from: juror1 }), ERROR_TOKEN_TRANSFER_FAILED)
    })

    it('receive approval fails if collateral token approve fails', async () => {
      const amount = DEFAULTS.minActiveBalance.mul(PPM).div(exchangeRate)

      await badCollateralToken.approve(cpa.address, amount, { from: juror1 })
      // make token misbehave
      await badCollateralToken.setApproveMisbehave(true)

      await assertRevert(cpa.receiveApproval(juror1, amount, badCollateralToken.address, '0x00', { from: juror1 }), ERROR_TOKEN_APPROVAL_FAILED)
    })

    it('contribute external token fails if collateral token transfer fails', async () => {
      const externalExchangeRate = bn(500000)
      const collateralAmount = DEFAULTS.minActiveBalance.mul(PPM).div(exchangeRate)
      const externalAmount = collateralAmount.mul(PPM).div(externalExchangeRate)

      await badExternalToken.approve(cpa.address, externalAmount, { from: juror1 })

      // make token misbehave
      await badExternalToken.setTransferMisbehave(true)

      await assertRevert(cpa.contributeExternalToken(badExternalToken.address, juror1, externalAmount, 1, 1, 0, { from: juror1 }), ERROR_TOKEN_TRANSFER_FAILED)
    })
  })
})
