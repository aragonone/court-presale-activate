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
const RegistryBuyAndStakeWrapper = artifacts.require('RegistryBuyAndStakeWrapper')

const getDeadline = async () => bn((await getBlock(await getBlockNumber())).timestamp).add(bn(86400))


contract('Court presale and activate wrapper', ([_, owner, provider, juror1]) => {
  const ZERO_ADDRESS = '0x' + '0'.repeat(40)

  const ERROR_TOKEN_NOT_CONTRACT = 'RBSW_TOKEN_NOT_CONTRACT'
  const ERROR_REGISTRY_NOT_CONTRACT = 'RBSW_REGISTRY_NOT_CONTRACT'
  const ERROR_PRESALE_NOT_CONTRACT = 'RBSW_PRESALE_NOT_CONTRACT'
  const ERROR_UNISWAP_FACTORY_NOT_CONTRACT = 'RBSW_UNISWAP_FACTORY_NOT_CONTRACT'
  const ERROR_ZERO_AMOUNT = 'RBSW_ZERO_AMOUNT'
  const ERROR_WRONG_TOKEN = 'RBSW_WRONG_TOKEN'
  const ERROR_TOKEN_TRANSFER_FAILED = 'RBSW_TOKEN_TRANSFER_FAILED'
  const ERROR_TOKEN_APPROVAL_FAILED = 'RBSW_TOKEN_APPROVAL_FAILED'
  const ERROR_UNISWAP_UNAVAILABLE = 'RBSW_UNISWAP_UNAVAILABLE'

  const INITIAL_BIG_TOKEN_AMOUNT = bigExp(1, 24)
  const exchangeRate = bn(200000)
  const PPM = bn(1000000)

  context('Regular tokens', () => {
    let collateralToken, bondedToken, registry, presale, uniswapFactory
    beforeEach('Deploy token, registry and presale', async () => {
      ({ collateralToken, bondedToken, registry, presale, uniswapFactory } = await deploy({ owner, exchangeRate }))
      await collateralToken.mint(juror1, INITIAL_BIG_TOKEN_AMOUNT)
    })

    context('Deployment fails', () => {
      it('fails when bonded token is empty address', async () => {
        await assertRevert(RegistryBuyAndStakeWrapper.new(ZERO_ADDRESS, registry.address, presale.address, uniswapFactory.address), ERROR_TOKEN_NOT_CONTRACT)
      })

      it('fails when registry is empty address', async () => {
        await assertRevert(RegistryBuyAndStakeWrapper.new(bondedToken.address, ZERO_ADDRESS, presale.address, uniswapFactory.address), ERROR_REGISTRY_NOT_CONTRACT)
      })

      it('fails when presale is empty address', async () => {
        await assertRevert(RegistryBuyAndStakeWrapper.new(bondedToken.address, registry.address, ZERO_ADDRESS, uniswapFactory.address), ERROR_PRESALE_NOT_CONTRACT)
      })

      it('fails when uniswapFactory is empty address', async () => {
        await assertRevert(RegistryBuyAndStakeWrapper.new(bondedToken.address, registry.address, presale.address, ZERO_ADDRESS), ERROR_UNISWAP_FACTORY_NOT_CONTRACT)
      })
    })

    const testContribute = (activate) => {
      let wrapper
      const activateData = activate ? '0x01' : '0x'
      const activateDescription = activate ? ' and activates' : ''

      beforeEach('Deploy airdrop contract', async () => {
        // deploy
        wrapper = await RegistryBuyAndStakeWrapper.new(bondedToken.address, registry.address, presale.address, uniswapFactory.address, { from: owner })
      })

      context('Bonded token', () => {
        it('fails when amount is zero', async () => {
          await assertRevert(collateralToken.approveAndCall(wrapper.address, 0, activateData), ERROR_ZERO_AMOUNT)
        })

        it('buys, stakes' + activateDescription + ', using ApproveAndCall fallback', async () => {
          const amount = DEFAULTS.minActiveBalance.mul(PPM).div(exchangeRate)
          const initialActiveAmount = (await registry.balanceOf(juror1))[0]
          const bondedTokensToGet = await presale.contributionToTokens(amount);

          await collateralToken.approveAndCall(wrapper.address, amount, activateData, { from: juror1 })

          const finalActiveAmount = (await registry.balanceOf(juror1))[0]
          const expectedActiveAmount = activate ? initialActiveAmount.add(bondedTokensToGet) : bn(0)
          assertBn(finalActiveAmount, expectedActiveAmount, `Active balance `)
        })

        it('buys, stakes' + activateDescription + ', in two transactions', async () => {
          const amount = DEFAULTS.minActiveBalance.mul(PPM).div(exchangeRate)
          const initialActiveAmount = (await registry.balanceOf(juror1))[0]
          const bondedTokensToGet = await presale.contributionToTokens(amount);

          await collateralToken.approve(wrapper.address, amount, { from: juror1 })
          await wrapper.receiveApproval(juror1, amount, collateralToken.address, activateData, { from: juror1 })

          const finalActiveAmount = (await registry.balanceOf(juror1))[0]
          const expectedActiveAmount = activate ? initialActiveAmount.add(bondedTokensToGet) : bn(0)
          assertBn(finalActiveAmount, expectedActiveAmount, `Active balance `)
          assert.equal((await collateralToken.balanceOf(wrapper.address)).toNumber(), 0, 'Wrapper collateral token balance should always be zero')
          assert.equal((await bondedToken.balanceOf(wrapper.address)).toNumber(), 0, 'Wrapper bonded token balance should always be zero')
        })

        it('fails in receive approval with wrong token', async () => {
          const amount = DEFAULTS.minActiveBalance.mul(PPM).div(exchangeRate)

          await bondedToken.approve(wrapper.address, amount, { from: juror1 })
          await assertRevert(wrapper.receiveApproval(juror1, amount, bondedToken.address, activateData, { from: juror1 }), ERROR_WRONG_TOKEN)
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
            await assertRevert(wrapper.contributeExternalToken(0, externalToken.address, 1, 1, await getDeadline(), activate, { from: juror1 }), ERROR_ZERO_AMOUNT)
          })

          it('buys, stakes' + activateDescription, async () => {
            const externalAmount = bigExp(1, 21)
            const ethAmount = await uniswapExternalExchange.getTokenToEthInputPrice(externalAmount)
            const collateralAmount = await uniswapCollateralExchange.getEthToTokenInputPrice(ethAmount)
            const initialActiveAmount = (await registry.balanceOf(juror1))[0]
            const bondedTokensToGet = await presale.contributionToTokens(collateralAmount);

            await externalToken.approve(wrapper.address, externalAmount, { from: juror1 })
            await wrapper.contributeExternalToken(externalAmount, externalToken.address, 1, 1, await getDeadline(), activate, { from: juror1 })

            const finalActiveAmount = (await registry.balanceOf(juror1))[0]
            const expectedActiveAmount = activate ? initialActiveAmount.add(bondedTokensToGet) : bn(0)
            assertBn(finalActiveAmount, expectedActiveAmount, `Active balance `)
            assert.equal((await externalToken.balanceOf(wrapper.address)).toNumber(), 0, 'Wrapper external token balance should always be zero')
            assert.equal((await collateralToken.balanceOf(wrapper.address)).toNumber(), 0, 'Wrapper collateral token balance should always be zero')
            assert.equal((await bondedToken.balanceOf(wrapper.address)).toNumber(), 0, 'Wrapper bonded token balance should always be zero')
          })
        })

        context('ETH', () => {
          const ETH = '0x' + '0'.repeat(40)

          it('fails when amount is zero', async () => {
            await assertRevert(wrapper.contributeEth(1, await getDeadline(), activate, { from: juror1, value: 0 }), ERROR_ZERO_AMOUNT)
          })

          it('buys, stakes' + activateDescription, async () => {
            const ethAmount = bigExp(1, 16)
            const collateralAmount = await uniswapCollateralExchange.getEthToTokenInputPrice(ethAmount)
            const initialActiveAmount = (await registry.balanceOf(juror1))[0]
            const bondedTokensToGet = await presale.contributionToTokens(collateralAmount);

            await wrapper.contributeEth(1, await getDeadline(), activate, { from: juror1, value: ethAmount })

            const finalActiveAmount = (await registry.balanceOf(juror1))[0]
            const expectedActiveAmount = activate ? initialActiveAmount.add(bondedTokensToGet) : bn(0)
            assertBn(finalActiveAmount, expectedActiveAmount, `Active balance `)
            assert.equal(await getBalance(wrapper.address), '0', 'Wrapper ETH balance should always be zero')
            assert.equal((await collateralToken.balanceOf(wrapper.address)).toNumber(), 0, 'Wrapper collateral token balance should always be zero')
            assert.equal((await bondedToken.balanceOf(wrapper.address)).toNumber(), 0, 'Wrapper bonded token balance should always be zero')
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
    let wrapper, badCollateralToken, badExternalToken

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
      wrapper = await RegistryBuyAndStakeWrapper.new(badCollateralToken.address, registry.address, presale.address, uniswapFactory.address, { from: owner })
    })

    it('receive approval fails if collateral token transfer fails', async () => {
      const amount = DEFAULTS.minActiveBalance.mul(PPM).div(exchangeRate)

      // make token misbehave
      await badCollateralToken.setTransferMisbehave(true)

      await assertRevert(badCollateralToken.approveAndCall(wrapper.address, amount, '0x00', { from: juror1 }), ERROR_TOKEN_TRANSFER_FAILED)
    })

    it('receive approval fails if collateral token approve fails', async () => {
      const amount = DEFAULTS.minActiveBalance.mul(PPM).div(exchangeRate)

      await badCollateralToken.approve(wrapper.address, amount, { from: juror1 })
      // make token misbehave
      await badCollateralToken.setApproveMisbehave(true)

      await assertRevert(wrapper.receiveApproval(juror1, amount, badCollateralToken.address, '0x00', { from: juror1 }), ERROR_TOKEN_APPROVAL_FAILED)
    })

    it('contribute external token fails if collateral token approve fails', async () => {
      const externalAmount = bigExp(1, 21)

      await badExternalToken.approve(wrapper.address, externalAmount, { from: juror1 })

      // make token misbehave
      await badExternalToken.setApproveMisbehave(true)

      await assertRevert(wrapper.contributeExternalToken(externalAmount, badExternalToken.address, 1, 1, await getDeadline(), true, { from: juror1 }), ERROR_TOKEN_APPROVAL_FAILED)
    })

    it('contribute external token fails if collateral token transfer fails', async () => {
      const externalAmount = bigExp(1, 21)

      await badExternalToken.approve(wrapper.address, externalAmount, { from: juror1 })

      // make token misbehave
      await badExternalToken.setTransferMisbehave(true)

      await assertRevert(wrapper.contributeExternalToken(externalAmount, badExternalToken.address, 1, 1, await getDeadline(), true, { from: juror1 }), ERROR_TOKEN_TRANSFER_FAILED)
    })
  })

  context('Without Uniswap exchange', () => {
    let wrapper

    beforeEach('Deploy airdrop contract', async () => {
      const uniswapFactory = await UniswapFactory.new()
      const { bondedToken, registry, presale } = await deploy({ owner, exchangeRate, uniswapFactory })

      // deploy wrapper
      wrapper = await RegistryBuyAndStakeWrapper.new(bondedToken.address, registry.address, presale.address, uniswapFactory.address, { from: owner })
    })

    context('External token', () => {
      let externalToken

      beforeEach('deploy external token, mint and create Uniswap exchange', async () => {
        externalToken = await ERC20.new('External Token', 'ET', 18)
        await externalToken.mint(juror1, INITIAL_BIG_TOKEN_AMOUNT)
      })

      it('fails when there is no Uniswap exchange', async () => {
        const externalAmount = bigExp(1, 21)
        await externalToken.approve(wrapper.address, externalAmount, { from: juror1 })
        await assertRevert(wrapper.contributeExternalToken(externalAmount, externalToken.address, 1, 1, await getDeadline(), true, { from: juror1 }), ERROR_UNISWAP_UNAVAILABLE)
      })
    })

    context('ETH', () => {
      const ETH = '0x' + '0'.repeat(40)

      it('fails when there is no Uniswap exchange', async () => {
        const ethAmount = bigExp(1, 16)
        await assertRevert(wrapper.contributeEth(1, await getDeadline(), true, { from: juror1, value: ethAmount }), ERROR_UNISWAP_UNAVAILABLE)
      })
    })
  })

})
