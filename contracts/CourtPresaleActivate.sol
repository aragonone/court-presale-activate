pragma solidity ^0.5.8;

import "@aragon/court/contracts/lib/os/IsContract.sol";
import "@aragon/court/contracts/lib/os/ERC20.sol";
import "@aragon/court/contracts/lib/os/SafeERC20.sol";
import "@aragon/court/contracts/standards/ERC900.sol";
import "./lib/IPresale.sol";


contract CourtPresaleActivate is IsContract{
    using SafeERC20 for ERC20;

    string private constant ERROR_TOKEN_NOT_CONTRACT = "CPA_TOKEN_NOT_CONTRACT";
    string private constant ERROR_REGISTRY_NOT_CONTRACT = "CPA_REGISTRY_NOT_CONTRACT";
    string private constant ERROR_PRESALE_NOT_CONTRACT = "CPA_PRESALE_NOT_CONTRACT";
    string private constant ERROR_ZERO_AMOUNT = "CPA_ZERO_AMOUNT";
    string private constant ERROR_TOKEN_TRANSFER_FAILED = "CPA_TOKEN_TRANSFER_FAILED";

    bytes32 internal constant ACTIVATE_DATA = keccak256("activate(uint256)");

    ERC20 public bondedToken;
    ERC900 public registry;
    IPresale public presale;

    event TokensActivated(address indexed token, address indexed sender, address indexed activator, uint256 amount);

    constructor(ERC20 _bondedToken, ERC900 _registry, IPresale _presale) public {
        require(isContract(address(_bondedToken)), ERROR_TOKEN_NOT_CONTRACT);
        require(isContract(address(_registry)), ERROR_REGISTRY_NOT_CONTRACT);
        require(isContract(address(_presale)), ERROR_PRESALE_NOT_CONTRACT);

        bondedToken = _bondedToken;
        registry = _registry;
        presale = _presale;
    }

    /**
    * @notice Buy and activate `@tokenAmount(self.bondedToken(): address, _amount, false)` tokens for sender
    */
    function buyAndActivate(uint256 _amount) external {
        require(_amount > 0, ERROR_ZERO_AMOUNT);

        // buy in presale
        // TODO: we should approve and call this function
        presale.contribute(msg.sender, _amount);
        uint256 bondedTokensObtained = presale.contributionToTokens(_amount);

        // approve bonded tokens to registry
        require(bondedToken.safeTransferFrom(msg.sender, address(this), bondedTokensObtained), ERROR_TOKEN_TRANSFER_FAILED);
        bondedToken.approve(address(registry), bondedTokensObtained);

        // activate in registry
        registry.stakeFor(msg.sender, bondedTokensObtained, abi.encodePacked(ACTIVATE_DATA));
        emit TokensActivated(address(bondedToken), msg.sender, address(this), _amount);
    }
}
