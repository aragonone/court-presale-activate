const { assertBn } = require('@aragon/court/test/helpers/asserts/assertBn')
const { assertRevert } = require('@aragon/court/test/helpers/asserts/assertThrow')
const getBalance = require('@aragon/test-helpers/balance')(web3)
const getBlockNumber = require('@aragon/test-helpers/blockNumber')(web3)
const getBlock = require('@aragon/test-helpers/block')(web3)
const { DEFAULTS } = require('@aragon/court/test/helpers/wrappers/court')(web3, artifacts)
const { bn, bigExp } = require('@aragon/court/test/helpers/lib/numbers')

const { deploy } = require('./helpers/deploy')

const ERC20 = artifacts.require('ERC20Mock')
const ERC20Bad = artifacts.require('ERC20BadMock')
const UniswapFactory = artifacts.require('UniswapFactory')
const UniswapExchange = artifacts.require('UniswapExchange')
const CourtPresaleActivate = artifacts.require('CourtPresaleActivate')

const getDeadline = async () => bn((await getBlock(await getBlockNumber())).timestamp).add(bn(86400))


contract('Court presale and activate wrapper', ([_, owner, provider, juror1, other]) => {
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
  const ERROR_UNISWAP_UNAVAILABLE = 'CPA_UNISWAP_UNAVAILABLE'

  const INITIAL_BIG_TOKEN_AMOUNT = bigExp(1, 24)
  const exchangeRate = bn(200000)
  const PPM = bn(1000000)

  context('Regular tokens', () => {
    beforeEach('Deploy token, registry and presale', async () => {
      ({ collateralToken, bondedToken, registry, presale, uniswapFactory } = await deploy({ owner, exchangeRate }))
      await collateralToken.mint(juror1, INITIAL_BIG_TOKEN_AMOUNT)
    })

    context('Deployment fails', () => {
      it('fails when bonded token is empty address', async () => {
        await assertRevert(CourtPresaleActivate.new(owner, ZERO_ADDRESS, registry.address, presale.address, uniswapFactory.address), ERROR_TOKEN_NOT_CONTRACT)
      })

      it('fails when registry is empty address', async () => {
        await assertRevert(CourtPresaleActivate.new(owner, bondedToken.address, ZERO_ADDRESS, presale.address, uniswapFactory.address), ERROR_REGISTRY_NOT_CONTRACT)
      })

      it('fails when presale is empty address', async () => {
        await assertRevert(CourtPresaleActivate.new(owner, bondedToken.address, registry.address, ZERO_ADDRESS, uniswapFactory.address), ERROR_PRESALE_NOT_CONTRACT)
      })

      it('fails when uniswapFactory is empty address', async () => {
        await assertRevert(CourtPresaleActivate.new(owner, bondedToken.address, registry.address, presale.address, ZERO_ADDRESS), ERROR_UNISWAP_FACTORY_NOT_CONTRACT)
      })
    })

    const testContribute = (activate) => {
      let cpa
      const activateData = activate ? '0x01' : '0x'
      const activateDescription = activate ? ' and activates' : ''

      beforeEach('Deploy airdrop contract', async () => {
        // deploy
        cpa = await CourtPresaleActivate.new(owner, bondedToken.address, registry.address, presale.address, uniswapFactory.address, { from: owner })
      })

      const checkFinalBalances = async (amount, activate, initialActiveAmount, initialUserBalance) => {
        const bondedTokensToGet = await presale.contributionToTokens(amount)
        const finalActiveAmount = (await registry.balanceOf(juror1))[0]
        const finalUserBalance = await bondedToken.balanceOf(juror1)
        let expectedActiveAmount
        let expectedUserBalance
        if (activate) {
          expectedActiveAmount = initialActiveAmount.add(bondedTokensToGet)
          expectedUserBalance = initialUserBalance
        } else {
          expectedActiveAmount = initialActiveAmount
          expectedUserBalance = initialUserBalance.add(bondedTokensToGet)
        }
        assertBn(finalActiveAmount, expectedActiveAmount, `Active balance doesn't match`)
        assertBn(finalUserBalance, expectedUserBalance, `User's balance doesn't match`)
      }

      context('Bonded token', () => {
        it('fails when amount is zero', async () => {
          await assertRevert(collateralToken.approveAndCall(cpa.address, 0, activateData), ERROR_ZERO_AMOUNT)
        })

        it(`buys, stakes${activateDescription}, using ApproveAndCall fallback`, async () => {
          const amount = DEFAULTS.minActiveBalance.mul(PPM).div(exchangeRate)
          const initialActiveAmount = (await registry.balanceOf(juror1))[0]
          const initialUserBalance = await bondedToken.balanceOf(juror1)

          await collateralToken.approveAndCall(cpa.address, amount, activateData, { from: juror1 })

          await checkFinalBalances(amount, activate, initialActiveAmount, initialUserBalance)
        })

        it('fails in receive approval with wrong token', async () => {
          const amount = DEFAULTS.minActiveBalance.mul(PPM).div(exchangeRate)

          await bondedToken.approve(cpa.address, amount, { from: juror1 })
          await assertRevert(cpa.receiveApproval(juror1, amount, bondedToken.address, activateData, { from: juror1 }), ERROR_WRONG_TOKEN)
        })

        it('cannot use receive approval for own account', async () => {
          const amount = DEFAULTS.minActiveBalance.mul(PPM).div(exchangeRate)
          const initialCollateralBalance = await bondedToken.balanceOf(juror1)
          const initialBondedBalance = await bondedToken.balanceOf(juror1)

          await collateralToken.approve(cpa.address, amount, { from: juror1 })
          await assertRevert(cpa.receiveApproval(juror1, amount, collateralToken.address, activateData, { from: juror1 }), ERROR_WRONG_TOKEN)

          assert.equal((await bondedToken.balanceOf(cpa.address)).toNumber(), initialBondedBalance, 'User bonded token balance should be same as initial')
          assert.equal((await collateralToken.balanceOf(cpa.address)).toNumber(), initialCollateralBalance, 'User collateral token balance should be same as initial')
        })

        it('cannot buy for any other approved account', async () => {
          const amount = DEFAULTS.minActiveBalance.mul(PPM).div(exchangeRate)
          const initialCollateralBalance = await bondedToken.balanceOf(juror1)
          const initialBondedBalance = await bondedToken.balanceOf(juror1)

          await collateralToken.approve(cpa.address, amount, { from: juror1 })
          await assertRevert(cpa.receiveApproval(juror1, amount, collateralToken.address, activateData, { from: other }), ERROR_WRONG_TOKEN)

          assert.equal((await bondedToken.balanceOf(cpa.address)).toNumber(), initialBondedBalance, 'User bonded token balance should be same as initial')
          assert.equal((await collateralToken.balanceOf(cpa.address)).toNumber(), initialCollateralBalance, 'User collateral token balance should be same as initial')
        })
      })

      context('Using Uniswap', () => {
        let uniswapCollateralExchange

        const addLiquidity = async (token) => {
          const ethAmount = bigExp(1, 18)
          const uniswapExchangeAddress = await uniswapFactory.getExchange(token.address)
          const uniswapExchange = await UniswapExchange.at(uniswapExchangeAddress)
          await token.mint(provider, INITIAL_BIG_TOKEN_AMOUNT)
          await token.approve(uniswapExchangeAddress, INITIAL_BIG_TOKEN_AMOUNT, { from: provider })
          await uniswapExchange.addLiquidity(0, INITIAL_BIG_TOKEN_AMOUNT, await getDeadline(), { from: provider, value: ethAmount })

          return uniswapExchange
        }

        beforeEach('create Uniswap liquidity pools', async () => {
          uniswapCollateralExchange = await addLiquidity(collateralToken)
        })

        context('External token', () => {
          let externalToken, uniswapExternalExchange

          beforeEach('deploy external token, mint and create Uniswap exchange', async () => {
            externalToken = await ERC20.new('External Token', 'ET', 18)
            await externalToken.mint(juror1, INITIAL_BIG_TOKEN_AMOUNT)
            // set up in Uniswap
            await uniswapFactory.createExchange(externalToken.address)
            uniswapExternalExchange = await addLiquidity(externalToken)
          })

          it('fails when amount is zero', async () => {
            await assertRevert(cpa.contributeExternalToken(externalToken.address, 0, 1, 1, 0, activate, { from: juror1 }), ERROR_ZERO_AMOUNT)
          })

          it('fails when external token is the same as collateral token', async () => {
            const externalAmount = bigExp(1, 21)
            const ethAmount = await uniswapExternalExchange.getTokenToEthInputPrice(externalAmount)
            const collateralAmount = await uniswapCollateralExchange.getEthToTokenInputPrice(ethAmount)
            await assertRevert(cpa.contributeExternalToken(collateralToken.address, collateralAmount, 1, 1, 0, { from: juror1 }), ERROR_WRONG_TOKEN)
          })

          it(`buys, stakes${activateDescription}`, async () => {
            const externalAmount = bigExp(1, 21)
            const ethAmount = await uniswapExternalExchange.getTokenToEthInputPrice(externalAmount)
            const collateralAmount = await uniswapCollateralExchange.getEthToTokenInputPrice(ethAmount)
            const initialActiveAmount = (await registry.balanceOf(juror1))[0]
            const initialUserBalance = await bondedToken.balanceOf(juror1)

            await externalToken.approve(cpa.address, externalAmount, { from: juror1 })
            await cpa.contributeExternalToken(externalToken.address, externalAmount, 1, 1, await getDeadline(), activate, { from: juror1 })

            await checkFinalBalances(collateralAmount, activate, initialActiveAmount, initialUserBalance)

            assert.equal((await externalToken.balanceOf(cpa.address)).toNumber(), 0, 'Wrapper external token balance should always be zero')
            assert.equal((await collateralToken.balanceOf(cpa.address)).toNumber(), 0, 'Wrapper collateral token balance should always be zero')
            assert.equal((await bondedToken.balanceOf(cpa.address)).toNumber(), 0, 'Wrapper bonded token balance should always be zero')
          })
        })

        context('ETH', () => {
          const ETH = '0x' + '0'.repeat(40)

          it('fails when amount is zero', async () => {
            await assertRevert(cpa.contributeEth(1, 0, activate, { from: juror1, value: 0 }), ERROR_ZERO_AMOUNT)
          })

          it(`buys, stakes${activateDescription}`, async () => {
            const ethAmount = bigExp(1, 16)
            const collateralAmount = await uniswapCollateralExchange.getEthToTokenInputPrice(ethAmount)
            const initialActiveAmount = (await registry.balanceOf(juror1))[0]
            const initialUserBalance = await bondedToken.balanceOf(juror1)

            await cpa.contributeEth(1, await getDeadline(), activate, { from: juror1, value: ethAmount })

            await checkFinalBalances(collateralAmount, activate, initialActiveAmount, initialUserBalance)

            assert.equal(await getBalance(cpa.address), '0', 'Wrapper ETH balance should always be zero')
            assert.equal((await collateralToken.balanceOf(cpa.address)).toNumber(), 0, 'Wrapper collateral token balance should always be zero')
            assert.equal((await bondedToken.balanceOf(cpa.address)).toNumber(), 0, 'Wrapper bonded token balance should always be zero')
          })

          it(`buys, stakes${activateDescription} using fallback`, async () => {
            const ethAmount = bigExp(1, 16)
            const collateralAmount = await uniswapCollateralExchange.getEthToTokenInputPrice(ethAmount)
            const initialActiveAmount = (await registry.balanceOf(juror1))[0]
            const initialUserBalance = await bondedToken.balanceOf(juror1)

            await cpa.sendTransaction({ from: juror1, value: ethAmount, data: activateData })

            await checkFinalBalances(collateralAmount, activate, initialActiveAmount, initialUserBalance)

            assert.equal(await getBalance(cpa.address), '0', 'Wrapper ETH balance should always be zero')
            assert.equal((await collateralToken.balanceOf(cpa.address)).toNumber(), 0, 'Wrapper collateral token balance should always be zero')
            assert.equal((await bondedToken.balanceOf(cpa.address)).toNumber(), 0, 'Wrapper bonded token balance should always be zero')
          })
        })
      })
    }

    context('Succesfully deployed', () => {
      context('Activates tokens', () => {
        testContribute(true)
      })

      context('Doesn\'t activate tokens', () => {
        testContribute(false)
      })
    })
  })

  context('Bad tokens', () => {
    let cpa, badCollateralToken, badExternalToken

    beforeEach('Deploy airdrop contract', async () => {
      // deploy bad tokens
      badCollateralToken = await ERC20Bad.new('Collateral Bad Token', 'CBT', 18)
      await badCollateralToken.mint(juror1, INITIAL_BIG_TOKEN_AMOUNT)
      badExternalToken = await ERC20Bad.new('External Bad Token', 'EBT', 18)
      await badExternalToken.mint(juror1, INITIAL_BIG_TOKEN_AMOUNT)

      const { registry, presale, uniswapFactory } = await deploy({ owner, exchangeRate, collateralToken: badCollateralToken })

      // set up in Uniswap
      await uniswapFactory.createExchange(badExternalToken.address)

      // deploy wrapper
      cpa = await CourtPresaleActivate.new(owner, badCollateralToken.address, registry.address, presale.address, uniswapFactory.address, { from: owner })
    })

    it('receive approval fails if collateral token transfer fails', async () => {
      const amount = DEFAULTS.minActiveBalance.mul(PPM).div(exchangeRate)

      // make token misbehave
      await badCollateralToken.setTransferMisbehave(true)

      await assertRevert(badCollateralToken.approveAndCall(cpa.address, amount, '0x00', { from: juror1 }), ERROR_TOKEN_TRANSFER_FAILED)
    })

    it('contribute external token fails if collateral token approve fails', async () => {
      const externalAmount = bigExp(1, 21)

      await badExternalToken.approve(cpa.address, externalAmount, { from: juror1 })

      // make token misbehave
      await badExternalToken.setApproveMisbehave(true)

      await assertRevert(cpa.contributeExternalToken(badExternalToken.address, externalAmount, 1, 1, await getDeadline(), true, { from: juror1 }), ERROR_TOKEN_APPROVAL_FAILED)
    })

    it('contribute external token fails if collateral token transfer fails', async () => {
      const externalAmount = bigExp(1, 21)

      await badExternalToken.approve(cpa.address, externalAmount, { from: juror1 })

      // make token misbehave
      await badExternalToken.setTransferMisbehave(true)

      await assertRevert(cpa.contributeExternalToken(badExternalToken.address, externalAmount, 1, 1, await getDeadline(), true, { from: juror1 }), ERROR_TOKEN_TRANSFER_FAILED)
    })
  })

  context('Without Uniswap exchange', () => {
    let cpa

    beforeEach('Deploy airdrop contract', async () => {
      const uniswapFactory = await UniswapFactory.new()
      const { collateralToken, registry, presale } = await deploy({ owner, exchangeRate, uniswapFactory })

      // deploy wrapper
      cpa = await CourtPresaleActivate.new(owner, collateralToken.address, registry.address, presale.address, uniswapFactory.address, { from: owner })
    })

    context('External token', () => {
      let externalToken

      beforeEach('deploy external token, mint and create Uniswap exchange', async () => {
        externalToken = await ERC20.new('External Token', 'ET', 18)
        await externalToken.mint(juror1, INITIAL_BIG_TOKEN_AMOUNT)
      })

      it('fails when there is no Uniswap exchange', async () => {
        const externalAmount = bigExp(1, 21)
        await externalToken.approve(cpa.address, externalAmount, { from: juror1 })
        await assertRevert(cpa.contributeExternalToken(externalToken.address, externalAmount, 1, 1, await getDeadline(), true, { from: juror1 }), ERROR_UNISWAP_UNAVAILABLE)
      })
    })

    context('ETH', () => {
      const ETH = '0x' + '0'.repeat(40)

      it('fails when there is no Uniswap exchange', async () => {
        const ethAmount = bigExp(1, 16)
        await assertRevert(cpa.contributeEth(1, await getDeadline(), true, { from: juror1, value: ethAmount }), ERROR_UNISWAP_UNAVAILABLE)
      })
    })
  })
})
