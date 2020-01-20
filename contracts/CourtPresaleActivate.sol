pragma solidity ^0.5.8;

import "@aragon/court/contracts/lib/os/IsContract.sol";
import "@aragon/court/contracts/lib/os/ERC20.sol";
import "@aragon/court/contracts/lib/os/SafeERC20.sol";
import "@aragon/court/contracts/standards/ApproveAndCall.sol";
import "@aragon/court/contracts/standards/ERC900.sol";
import "./lib/IPresale.sol";
import "./lib/uniswap/interfaces/IUniswapExchange.sol";
import "./lib/uniswap/interfaces/IUniswapFactory.sol";


contract CourtPresaleActivate is IsContract, ApproveAndCallFallBack {
    using SafeERC20 for ERC20;

    string private constant ERROR_TOKEN_NOT_CONTRACT = "CPA_TOKEN_NOT_CONTRACT";
    string private constant ERROR_REGISTRY_NOT_CONTRACT = "CPA_REGISTRY_NOT_CONTRACT";
    string private constant ERROR_PRESALE_NOT_CONTRACT = "CPA_PRESALE_NOT_CONTRACT";
    string private constant ERROR_UNISWAP_FACTORY_NOT_CONTRACT = "CPA_UNISWAP_FACTORY_NOT_CONTRACT";
    string private constant ERROR_ZERO_AMOUNT = "CPA_ZERO_AMOUNT";
    string private constant ERROR_TOKEN_TRANSFER_FAILED = "CPA_TOKEN_TRANSFER_FAILED";
    string private constant ERROR_TOKEN_APPROVAL_FAILED = "CPA_TOKEN_APPROVAL_FAILED";
    string private constant ERROR_WRONG_TOKEN = "CPA_WRONG_TOKEN";
    string private constant ERROR_ETH_REFUND = "CPA_ETH_REFUND";
    string private constant ERROR_TOKEN_REFUND = "CPA_TOKEN_REFUND";
    string private constant ERROR_UNISWAP_UNAVAILABLE = "CPA_UNISWAP_UNAVAILABLE";

    bytes32 internal constant ACTIVATE_DATA = keccak256("activate(uint256)");

    ERC20 public bondedToken;
    ERC900 public registry;
    IPresale public presale;
    IUniswapFactory public uniswapFactory;

    event BoughtAndActivated(address from, address collateralToken, uint256 buyAmount, uint256 activatedAmount);

    constructor(ERC20 _bondedToken, ERC900 _registry, IPresale _presale, IUniswapFactory _uniswapFactory) public {
        require(isContract(address(_bondedToken)), ERROR_TOKEN_NOT_CONTRACT);
        require(isContract(address(_registry)), ERROR_REGISTRY_NOT_CONTRACT);
        require(isContract(address(_presale)), ERROR_PRESALE_NOT_CONTRACT);
        require(isContract(address(_uniswapFactory)), ERROR_UNISWAP_FACTORY_NOT_CONTRACT);

        bondedToken = _bondedToken;
        registry = _registry;
        presale = _presale;
        uniswapFactory = _uniswapFactory;
    }

    /**
    * @dev This function must be triggered by the contribution token approve-and-call fallback.
    *      It will pull the approved tokens and convert them into the presale instance, and activate the converted tokens into a
    *      jurors registry instance of an Aragon Court.
    * @param _from Address of the original caller (juror) converting and activating the tokens
    * @param _amount Amount of contribution tokens to be converted and activated
    * @param _token Address of the contribution token triggering the approve-and-call fallback
    * @param _data If non-empty it will signal token activation in the registry
    */
    function receiveApproval(address _from, uint256 _amount, address _token, bytes calldata _data) external {
        if (!presale.isClosed()) {
            _receiveApprovalPresale(_from, _amount, _token, _data);
        } else {
            _receiveApprovalBondingCurve(_from, _amount, _token, _data);
        }
    }

    /**
    * @dev This function needs a previous approval on the external token used for the contributed amount.
    *      It will pull the approved tokens, convert them in Uniswap to the presale contribution token,
    *      convert the obtained tokens in the presale instance, and activate the converted tokens in the
    *      jurors registry instance of the Aragon Court.
    * @param _token Address of the external contribution token used
    * @param _amount Amount of contribution tokens to be converted and activated
    * @param _minTokens Minimum amount of presale contribution tokens obtained in Uniswap
    * @param _minEth Minimum amount of ETH obtained in Uniswap (Uniswap internally converts first to ETH and then to target token)
    * @param _deadline Transaction deadline for Uniswap
    * @param _activate Signal activation of tokens in the registry
    */
    function contributeExternalToken(
        uint256 _amount,
        address _token,
        uint256 _minTokens,
        uint256 _minEth,
        uint256 _deadline,
        bool _activate
    )
        external
    {
        if (!presale.isClosed()) {
            _contributeExternalTokenPresale(_amount, _token, _minTokens, _minEth, _deadline, _activate);
        } else {
            _contributeExternalTokenBondingCurve(msg.sender, _amount, _token, _minTokens, _minEth, _deadline, _activate);
        }
    }

    /**
    * @dev It will send the received ETH to Uniswap to get presale contribution tokens,
    *      convert the obtained tokens in the presale instance, and activate the converted tokens in the
    *      jurors registry instance of the Aragon Court.
    * @param _minTokens Minimum amount of presale contribution tokens obtained in Uniswap
    * @param _deadline Transaction deadline for Uniswap
    * @param _activate Signal activation of tokens in the registry
    */
    function contributeEth(uint256 _minTokens, uint256 _deadline, bool _activate) external payable {
        require(msg.value > 0, ERROR_ZERO_AMOUNT);

        if (!presale.isClosed()) {
            _contributeEthPresale(_minTokens, _deadline, _activate);
        } else {
            _contributeEthBondingCurve(_minTokens, _deadline, _activate);
        }

        // make sure there's no ETH left
        uint256 ethBalance = address(this).balance;
        if (ethBalance > 0) {
            // solium-disable security/no-call-value
            (bool result,) = msg.sender.call.value(ethBalance)("");
            require(result, ERROR_ETH_REFUND);
        }
    }

    function _receiveApprovalPresale(address _from, uint256 _amount, address _token, bytes memory _data) internal {
        require(_amount > 0, ERROR_ZERO_AMOUNT);
        require(_token == address(presale.contributionToken()), ERROR_WRONG_TOKEN);

        bool activate;
        if (_data.length > 0) {
            activate = true;
        }

        // move tokens to this contract
        ERC20 token = ERC20(_token);
        require(token.safeTransferFrom(_from, address(this), _amount), ERROR_TOKEN_TRANSFER_FAILED);

        _buyAndActivate(_from, _amount, _token, activate);

        // refund leftovers if any
        _refund(_token);
    }

    function _receiveApprovalBondingCurve(address _from, uint256 _amount, address _token, bytes memory _data) internal {
        bool activate;
        uint256 minTokens;
        uint256 minEth;
        uint256 deadline;
        assembly {
            activate := mload(add(_data, 0x20))
            minTokens := mload(add(_data, 0x40))
            minEth := mload(add(_data, 0x60))
            deadline := mload(add(_data, 0x80))
        }

        _contributeExternalTokenBondingCurve(_from, _amount, _token, minTokens, minEth, deadline, activate);
    }

    function _setupUniswapExchange(address _from, uint256 _amount, address _token) internal returns (IUniswapExchange) {
        require(_amount > 0, ERROR_ZERO_AMOUNT);

        // move tokens to this contract
        ERC20 token = ERC20(_token);
        require(token.safeTransferFrom(_from, address(this), _amount), ERROR_TOKEN_TRANSFER_FAILED);

        // get the Uniswap exchange for the external token
        address payable uniswapExchangeAddress = uniswapFactory.getExchange(_token);
        require(uniswapExchangeAddress != address(0), ERROR_UNISWAP_UNAVAILABLE);
        IUniswapExchange uniswapExchange = IUniswapExchange(uniswapExchangeAddress);

        require(token.safeApprove(address(uniswapExchange), _amount), ERROR_TOKEN_APPROVAL_FAILED);

        return uniswapExchange;
    }

    function _contributeExternalTokenPresale(
        uint256 _amount,
        address _token,
        uint256 _minTokens,
        uint256 _minEth,
        uint256 _deadline,
        bool _activate
    )
        internal
    {
        IUniswapExchange uniswapExchange = _setupUniswapExchange(msg.sender, _amount, _token);

        // swap tokens
        address contributionTokenAddress = address(presale.contributionToken());
        uint256 contributionTokenAmount = uniswapExchange.tokenToTokenSwapInput(
            _amount,
            _minTokens,
            _minEth,
            _deadline,
            contributionTokenAddress
        );

        // buy in presale
        _buyAndActivate(msg.sender, contributionTokenAmount, contributionTokenAddress, _activate);

        // refund leftovers if any
        _refund(_token);
        _refund(contributionTokenAddress);
    }

    function _contributeExternalTokenBondingCurve(
        address _from,
        uint256 _amount,
        address _token,
        uint256 _minTokens,
        uint256 _minEth,
        uint256 _deadline,
        bool _activate
    )
        internal
    {
        IUniswapExchange uniswapExchange = _setupUniswapExchange(_from, _amount, _token);

        // swap tokens
        uint256 bondedTokenAmount = uniswapExchange.tokenToTokenSwapInput(_amount, _minTokens, _minEth, _deadline, address(bondedToken));

        // buy in presale
        _stakeAndActivate(_from, bondedTokenAmount, _activate);

        // refund leftovers if any
        _refund(_token);
        _refund(bondedToken);
    }

    function _contributeEthPresale(uint256 _minTokens, uint256 _deadline, bool _activate) internal {
        address contributionTokenAddress = address(presale.contributionToken());

        // get the Uniswap exchange for the contribution token
        address payable uniswapExchangeAddress = uniswapFactory.getExchange(contributionTokenAddress);
        require(uniswapExchangeAddress != address(0), ERROR_UNISWAP_UNAVAILABLE);
        IUniswapExchange uniswapExchange = IUniswapExchange(uniswapExchangeAddress);

        // swap tokens
        uint256 contributionTokenAmount = uniswapExchange.ethToTokenSwapInput.value(msg.value)(_minTokens, _deadline);

        // buy in presale
        _buyAndActivate(msg.sender, contributionTokenAmount, contributionTokenAddress, _activate);
    }

    function _contributeEthBondingCurve(uint256 _minTokens, uint256 _deadline, bool _activate) internal {
        // get the Uniswap exchange for the bonded token
        address payable uniswapExchangeAddress = uniswapFactory.getExchange(address(bondedToken));
        require(uniswapExchangeAddress != address(0), ERROR_UNISWAP_UNAVAILABLE);
        IUniswapExchange uniswapExchange = IUniswapExchange(uniswapExchangeAddress);

        // swap tokens
        uint256 bondedTokenAmount = uniswapExchange.ethToTokenSwapInput.value(msg.value)(_minTokens, _deadline);

        // buy in presale
        _stakeAndActivate(msg.sender, bondedTokenAmount, _activate);
    }

    function _buyAndActivate(address _from, uint256 _amount, address _token, bool _activate) internal {
        // approve to presale
        require(ERC20(_token).safeApprove(address(presale), _amount), ERROR_TOKEN_APPROVAL_FAILED);

        // buy in presale
        presale.contribute(address(this), _amount);
        uint256 bondedTokensObtained = presale.contributionToTokens(_amount);

        _stakeAndActivate(_from, bondedTokensObtained, _activate);

        emit BoughtAndActivated(_from, _token, _amount, bondedTokensObtained);
    }

    function _stakeAndActivate(address _from, uint256 _amount, bool _activate) internal {
        // activate in registry
        bondedToken.approve(address(registry), _amount);
        bytes memory data;
        if (_activate) {
            data = abi.encodePacked(ACTIVATE_DATA);
        }
        registry.stakeFor(_from, _amount, data);

        // refund leftovers if any
        _refund(bondedToken);
    }

    function _refund(address _tokenAddress) internal {
        ERC20 token = ERC20(_tokenAddress);
        _refund(token);
    }

    function _refund(ERC20 _token) internal {
        uint256 selfBalance = _token.balanceOf(address(this));
        if (selfBalance > 0) {
            require(_token.safeTransfer(msg.sender, selfBalance), ERROR_TOKEN_REFUND);
        }
    }
}
